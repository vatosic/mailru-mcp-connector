import { createSmtpTransport } from './smtp.js';
import { simpleParser } from 'mailparser';
import { createHash, randomUUID } from 'node:crypto';
import { constants, openSync, closeSync, writeFileSync, readFileSync, fsyncSync, lstatSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { address, messageId, sendSchemas } from './schema.js';

const hash = s => createHash('sha256').update(s).digest('hex');
const safeHeader = s => typeof s === 'string' && s.length <= 500 && !/[\x00-\x1f\x7f]/.test(s);
export class SendService {
 constructor(config, source, factory = createSmtpTransport, deadlineMs = 30000) {
  if (!config.sendEnabled) throw new Error('SEND_DISABLED');
  address.parse(config.user);
  const stat = lstatSync(config.sendStateDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.uid !== process.getuid()) throw new Error('PRIVATE_STATE_REQUIRED');
  if(!Number.isInteger(deadlineMs) || deadlineMs<1 || deadlineMs>30000) throw new Error('INVALID_DEADLINE');
  this.deadlineMs=deadlineMs;
  this.config=config; this.source=source; this.factory=factory; this.active=false;
 }
 path(key) { return join(this.config.sendStateDir,hash(this.config.user+'\0'+key)+'.json'); }
 syncDir() { const fd=openSync(this.config.sendStateDir,'r');try {fsyncSync(fd);} finally {closeSync(fd);} }
 read(path) {
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {return JSON.parse(readFileSync(fd,'utf8'));} finally {closeSync(fd);}
 }
 public(record) { return {status:record.status,messageId:record.messageId,deliveryConfirmed:false,sentCopy:'not_appended',retryAllowed:false}; }
 async send_status(input) {
  const a=sendSchemas.send_status.parse(input);
  try {return this.public(this.read(this.path(a.idempotencyKey)));} catch(e) {if(e.code==='ENOENT') return {status:'not_found'};throw e;}
 }
 async preview_reply(input) {
  const a=sendSchemas.preview_reply.parse(input);
  const p=await simpleParser(await this.source(a),{skipHtmlToText:true,skipTextToHtml:true,skipImageLinks:true});
  // Reject ambiguous duplicate routing/thread headers rather than silently choosing one.
  for(const name of ['from','reply-to','message-id','references','subject']) {
   if(p.headerLines.filter(h=>h.key===name).length>1) throw new Error('AMBIGUOUS_HEADERS');
  }
  const recipients=(p.replyTo || p.from)?.value;
  if(!recipients || recipients.length!==1) throw new Error('AMBIGUOUS_RECIPIENT');
  const to=address.parse(recipients[0].address);
  const id=messageId.parse(p.messageId);
  if(!safeHeader(p.subject ?? '')) throw new Error('INVALID_SUBJECT');
  let subject=p.subject || '(no subject)';
  if(!/^re:/i.test(subject)) subject='Re: '+subject;
  if(subject.length>200) throw new Error('SUBJECT_TOO_LONG');
  const refs=p.references === undefined ? [] : Array.isArray(p.references) ? p.references : [p.references];
  if(refs.length>30) throw new Error('THREAD_TOO_LONG');
  refs.forEach(r=>messageId.parse(r));
  return {to,subject,inReplyTo:id,references:[...new Set([...refs,id])],replyToDiffersFromFrom:!!p.replyTo && p.from?.value?.[0]?.address !== to};
 }
 async reply_mail(input) {
  const a=sendSchemas.reply_mail.parse(input);
  const original=await this.preview_reply({folder:a.folder,uid:a.uid,uidValidity:a.uidValidity});
  if(original.to!==a.expectedRecipient || original.inReplyTo!==a.expectedMessageId) throw new Error('REPLY_TARGET_CHANGED');
  return this.submit({to:original.to,subject:original.subject,text:a.text,inReplyTo:original.inReplyTo,references:original.references},a.idempotencyKey);
 }
 async send_mail(input) {
  const a=sendSchemas.send_mail.parse(input);
  return this.submit({to:a.to,subject:a.subject,text:a.text},a.idempotencyKey);
 }
 async submit(message,key) {
  const path=this.path(key);
  const fingerprint=hash(JSON.stringify({from:this.config.user,...message}));
  // A reservation survives restarts. Any unresolved reservation must be reconciled, never resent.
  try {
   const prior=this.read(path);
   if(prior.fingerprint!==fingerprint) throw new Error('IDEMPOTENCY_CONFLICT');
   return this.public(prior);
  } catch(e) {if(e.code!=='ENOENT') throw e;}
  if(this.active) throw new Error('SEND_BUSY');
  this.active=true;
  let transport;
  try {
   const record={fingerprint,status:'unknown',messageId:'<'+randomUUID()+'@'+this.config.user.split('@')[1]+'>'};
   let fd;
   try {fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
   catch(e) {
    if(e.code!=='EEXIST') throw e;
    const prior=this.read(path);
    if(prior.fingerprint!==fingerprint) throw new Error('IDEMPOTENCY_CONFLICT');
    return this.public(prior);
   }
   try {writeFileSync(fd,JSON.stringify(record));fsyncSync(fd);} finally {closeSync(fd);}
   this.syncDir(); // Must succeed before any SMTP connection.
   let timer;
   try {
    transport=this.factory({host:'smtp.mail.ru',port:465,secure:true,pool:false,
     tls:{rejectUnauthorized:true,minVersion:'TLSv1.2',servername:'smtp.mail.ru'},
     auth:{user:this.config.user,pass:this.config.password},logger:false,debug:false,
     connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,
     disableFileAccess:true,disableUrlAccess:true});
    const info=await Promise.race([transport.sendMail({from:this.config.user,...message,messageId:record.messageId,
     envelope:{from:this.config.user,to:[message.to]},disableFileAccess:true,disableUrlAccess:true}),
     new Promise((_,reject)=>{timer=setTimeout(()=>{try {transport.close();} catch {} reject(new Error('DEADLINE'));},this.deadlineMs);})]);
    if(info.accepted?.length===1 && info.rejected?.length===0) record.status='submitted';
   } catch { /* Could have been accepted before disconnect: never retry, never leak provider details. */ }
   finally {clearTimeout(timer);}
   // Failure to save the outcome leaves the earlier durable 'unknown' reservation.
   const temp=path+'.'+randomUUID()+'.tmp';
   const out=openSync(temp,'wx',0o600);
   try {writeFileSync(out,JSON.stringify(record));fsyncSync(out);} finally {closeSync(out);}
   renameSync(temp,path);this.syncDir();
   return this.public(record);
  } finally {try {transport?.close();} catch {} this.active=false;}
 }
}
