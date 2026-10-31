import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { convert } from 'html-to-text';
import { SendService } from './send.js';
import { schemas } from './schema.js';
const MAX_BYTES = 2 * 1024 * 1024;
const text = (v, max = 500) => String(v ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0,max);
export async function parseMail(source) {
 if (source.length > MAX_BYTES) throw new Error('MESSAGE_TOO_LARGE');
 const p = await simpleParser(source, {skipHtmlToText:true,skipTextToHtml:true,skipImageLinks:true});
 const body = p.text || (p.html ? convert(p.html, {wordwrap:false, selectors:[{selector:'a',options:{ignoreHref:true}},{selector:'img',format:'skip'},{selector:'script',format:'skip'},{selector:'style',format:'skip'}]}) : '');
 return {subject:text(p.subject), from:text(p.from?.text), to:text(p.to?.text), date:p.date?.toISOString() ?? null, text:text(body,16000), truncated:body.length > 16000, attachments:p.attachments.slice(0,30).map(a => ({filename:text(a.filename,200),contentType:text(a.contentType,100),size:a.size})), attachmentsTruncated:p.attachments.length > 30};
}
export class MailService {
 constructor(config, factory = options => new ImapFlow(options), operationTimeoutMs = 30000) {
  if (!Number.isInteger(operationTimeoutMs) || operationTimeoutMs < 1 || operationTimeoutMs > 30000) throw new Error('INVALID_DEADLINE');
  this.sender = config.sendEnabled ? new SendService(config, a => this.replySource(a)) : null;
  this.config=config; this.factory=factory; this.active=0; this.operationTimeoutMs=operationTimeoutMs;
 }
 async session(folder, fn) {
  if (folder && !this.config.folders.includes(folder)) throw new Error('FOLDER_NOT_ALLOWED');
  if(this.active >= 2) throw new Error('BUSY');
  this.active++;
  let client, timer, expired=false;
  const check=()=>{if(expired) throw new Error('OPERATION_TIMEOUT');};
  try {
   client=this.factory({host:'imap.mail.ru',port:993,secure:true,tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},auth:{user:this.config.user,pass:this.config.password},logger:false,disableAutoIdle:true,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000});
   client.on('error',()=>{}); // Never log provider errors: they can contain private data.
   const guarded=new Proxy(client,{get(target,key){
    const value=Reflect.get(target,key);
    if(typeof value !== 'function') return value;
    return async (...args)=>{check();const result=await value.apply(target,args);check();return result;};
   }});
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{
    expired=true;
    try {client.close();} catch {}
    reject(new Error('OPERATION_TIMEOUT'));
   },this.operationTimeoutMs);});
   const operation=(async()=>{
    await guarded.connect();
    if(folder) await guarded.mailboxOpen(folder,{readOnly:true});
    return await fn(guarded);
   })();
   return await Promise.race([operation,deadline]);
  } finally { clearTimeout(timer); try {client?.close();} catch {} this.active--; }
 }
 async list_folders(input) {
  schemas.list_folders.parse(input);
  return this.session(null,async c => ({folders:(await c.list()).filter(f => this.config.folders.includes(f.path)).map(f=>({path:f.path})).slice(0,20)}));
 }
 async search_mail(input) {
  const a=schemas.search_mail.parse(input);
  return this.session(a.folder,async c => {
   const count=c.mailbox.exists;
   if (!count) return {messages:[],scanLimit:500,windowed:false};
   const q={seq:`${Math.max(1,count-499)}:${count}`};
   for (const k of ['text','from','subject']) if(a[k]) q[k]=a[k];
   if(a.unseen !== undefined) q.seen=!a.unseen;
   const found=await c.search(q,{uid:true});
   if (!Array.isArray(found)) throw new Error('SEARCH_FAILED');
   const ids=found.sort((a,b)=>b-a);
   const messages=[];
   for (const uid of ids.slice(0,a.limit)) {
    const m=await c.fetchOne(uid,{uid:true,envelope:true,flags:true,size:true},{uid:true});
    if(m) messages.push({uid:m.uid,uidValidity:String(c.mailbox.uidValidity),folder:a.folder,subject:text(m.envelope?.subject),from:text(m.envelope?.from?.map(x=>x.address).join(', ')),date:m.envelope?.date?.toISOString() ?? null,unseen:!m.flags?.has('\\Seen'),size:m.size});
   }
   return {messages,moreMatches:ids.length>a.limit,scanLimit:500,windowed:count>500};
  });
 }
 async replySource(a) {
  return this.session(a.folder,async c=>{
   if(String(c.mailbox.uidValidity)!==a.uidValidity) throw new Error('STALE_UID');
   const meta=await c.fetchOne(a.uid,{size:true},{uid:true});
   if(!meta || !Number.isFinite(meta.size) || meta.size>MAX_BYTES) throw new Error('MESSAGE_UNAVAILABLE');
   const m=await c.fetchOne(a.uid,{source:{start:0,maxLength:MAX_BYTES+1}},{uid:true});
   if(!m?.source || m.source.length>MAX_BYTES) throw new Error('MESSAGE_UNAVAILABLE');
   return m.source;
  });
 }
 async read_mail(input) {
  const a=schemas.read_mail.parse(input);
  return this.session(a.folder,async c=>{
   if(String(c.mailbox.uidValidity)!==a.uidValidity) throw new Error('STALE_UID');
   const meta=await c.fetchOne(a.uid,{size:true},{uid:true});
   if(!meta) throw new Error('NOT_FOUND');
   if(!Number.isFinite(meta.size) || meta.size>MAX_BYTES) throw new Error('MESSAGE_TOO_LARGE');
   const m=await c.fetchOne(a.uid,{source:{start:0,maxLength:MAX_BYTES+1}},{uid:true});
   if(!m?.source) throw new Error('NOT_FOUND');
   return {folder:a.folder,uid:a.uid,uidValidity:a.uidValidity,...await parseMail(m.source)};
  });
 }
}
