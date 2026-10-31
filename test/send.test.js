import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,chmodSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SendService} from '../src/send.js';
import {loadConfig} from '../src/config.js';
import {sendSchemas,messageId} from '../src/schema.js';
import {MailService} from '../src/mail.js';

const env={MAILRU_USER:'fixture@mail.ru',MAILRU_APP_PASSWORD:'synthetic-test-only'};
const raw=(extra='')=>Buffer.from('From: Support <support@example.invalid>\r\nReply-To: ticket@example.invalid\r\nSubject: Тикет\r\nMessage-ID: <original@example.invalid>\r\nReferences: <older@example.invalid>\r\n'+extra+'\r\nBody');
const input={to:'support@example.invalid',subject:'Ответ',text:'Ок',idempotencyKey:'unique_test_key_001'};
function fixture(t,source=raw(),behavior=async()=>({accepted:[input.to],rejected:[]})) {
 const dir=mkdtempSync(join(tmpdir(),'mailru-send-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const config=loadConfig({...env,MAILRU_SEND_ENABLED:'true',MAILRU_SEND_STATE_DIR:dir});
 const calls=[]; const factory=o=>{calls.push(o);return {async sendMail(m){calls.push(m);return behavior(m);},close(){calls.push('close');}};};
 return {dir,config,calls,factory,service:new SendService(config,async()=>source,factory)};
}
test('sending is disabled by default and requires private absolute durable state',t=>{
 const c=loadConfig(env);assert.equal(c.sendEnabled,false);assert.equal(new MailService(c).sender,null);
 assert.throws(()=>loadConfig({...env,MAILRU_SEND_ENABLED:'yes'}));
 assert.throws(()=>loadConfig({...env,MAILRU_SEND_ENABLED:'true'}));
 assert.throws(()=>new SendService(c));
 const f=fixture(t);chmodSync(f.dir,0o755);assert.throws(()=>new SendService(f.config),/PRIVATE_STATE/);
});
test('strict send schema blocks injection, lists, extra sender, HTML, attachments and URLs',()=>{
 for(const bad of [{to:'a@example.invalid\r\nBcc: victim@example.invalid'},{to:'a@example.invalid,b@example.invalid'},{subject:'Hi\nBcc: x'},{from:'evil@example.invalid'},{html:'<b>x</b>'},{attachments:[]},{url:'https://example.invalid'},{idempotencyKey:'short'},{text:'x\0y'}])assert.equal(sendSchemas.send_mail.safeParse({...input,...bad}).success,false);
});
test('SMTP fixed verified TLS, fixed owner, UTF8 plaintext; durable submitted result survives restart',async t=>{
 const f=fixture(t);const r=await f.service.send_mail(input);assert.equal(r.status,'submitted');assert.equal(r.deliveryConfirmed,false);
 const options=f.calls[0],m=f.calls[1];assert.equal(options.host,'smtp.mail.ru');assert.equal(options.port,465);assert.equal(options.secure,true);assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.logger,false);
 assert.equal(m.from,env.MAILRU_USER);assert.equal(m.text,'Ок');assert.deepEqual(m.envelope,{from:env.MAILRU_USER,to:[input.to]});assert.equal(m.disableUrlAccess,true);
 const again=new SendService(f.config,async()=>raw(),()=>{throw Error('must not reconnect');});
 assert.deepEqual(await again.send_mail(input),r);
 await assert.rejects(again.send_mail({...input,text:'Different'}),/IDEMPOTENCY_CONFLICT/);
 assert.deepEqual(await again.send_status({idempotencyKey:input.idempotencyKey}),r);
 const state=readFileSync(join(f.dir,readdirSync(f.dir)[0]),'utf8');assert.ok(!state.includes('Ок'));assert.ok(!state.includes('synthetic'));
});
test('uncertain disconnect is persisted and never automatically retried or exposed',async t=>{
 const f=fixture(t,raw(),async()=>{throw Error('secret credentials / provider private error');});
 const r=await f.service.send_mail(input);assert.equal(r.status,'unknown');
 assert.deepEqual(await f.service.send_mail(input),r);assert.equal(f.calls.filter(x=>typeof x==='object'&&x.host).length,1);assert.ok(!JSON.stringify(r).includes('secret'));
});
test('concurrent same key causes exactly one SMTP submission',async t=>{
 let done;const f=fixture(t,raw(),()=>new Promise(resolve=>{done=resolve;}));
 const pending=f.service.send_mail(input);const duplicate=await f.service.send_mail(input);assert.equal(duplicate.status,'unknown');
 done({accepted:[input.to],rejected:[]});assert.equal((await pending).status,'submitted');assert.equal(f.calls.filter(x=>x?.host).length,1);
});
test('deadline records unknown, closes transport, blocks resend',async t=>{
 const f=fixture(t,raw(),()=>new Promise(()=>{}));
 const s=new SendService(f.config,async()=>raw(),f.factory,10);
 assert.equal((await s.send_mail(input)).status,'unknown');assert.ok(f.calls.includes('close'));assert.equal((await s.send_mail(input)).status,'unknown');
});
test('reply derives exact recipient and original threading; mismatch never sends',async t=>{
 const f=fixture(t);const ref={uid:1,uidValidity:'42'};
 const p=await f.service.preview_reply(ref);assert.equal(p.to,'ticket@example.invalid');assert.equal(p.subject,'Re: Тикет');assert.equal(p.replyToDiffersFromFrom,true);
 const a={...ref,expectedRecipient:p.to,expectedMessageId:p.inReplyTo,text:'Ок',idempotencyKey:input.idempotencyKey};
 await assert.rejects(f.service.reply_mail({...a,expectedRecipient:'evil@example.invalid'}),/TARGET_CHANGED/);assert.equal(f.calls.length,0);
 await f.service.reply_mail(a);assert.equal(f.calls[1].inReplyTo,'<original@example.invalid>');assert.deepEqual(f.calls[1].references,['<older@example.invalid>','<original@example.invalid>']);assert.equal(f.calls[1].to,p.to);
});
test('duplicate original headers, multiple recipients, absent IDs fail closed',async t=>{
 for(const source of [raw('Reply-To: evil@example.invalid\r\n'),Buffer.from('From: a@example.invalid, b@example.invalid\r\nMessage-ID: <a@example.invalid>\r\n\r\nX'),Buffer.from('From: a@example.invalid\r\n\r\nX')]){
  const f=fixture(t,source);await assert.rejects(f.service.preview_reply({uid:1,uidValidity:'42'}));assert.equal(f.calls.length,0);
 }
});
test('reply source retains IMAP readonly/size and stale-UID safeguards',async t=>{
 const f=fixture(t);const calls=[];const c={mailbox:{uidValidity:42n},on(){},async connect(){},close(){},async mailboxOpen(...a){calls.push(a);},async fetchOne(uid,q){return q.source?{source:raw()}:{size:1000};}};
 const m=new MailService(f.config,()=>c);
 await assert.rejects(m.sender.preview_reply({uid:1,uidValidity:'41'}),/STALE_UID/);
 const p=await m.sender.preview_reply({uid:1,uidValidity:'42'});assert.equal(p.to,'ticket@example.invalid');assert.ok(calls.every(x=>x[1].readOnly===true));
});

test('thread Message-ID rejects control bytes and multiple separators',()=>{
 for(const id of ['<a\0@b.invalid>','<a\x7f@b.invalid>','<a@b@c>','<a\r\n@b>','<<a>@b>']) assert.equal(messageId.safeParse(id).success,false);
 assert.equal(messageId.safeParse('<valid.id+tag@host.invalid>').success,true);
});

import nodemailer from 'nodemailer';
import {simpleParser} from 'mailparser';
test('actual MIME serializer preserves Russian text and reply headers offline',async t=>{
 const f=fixture(t);let serialized;
 const s=new SendService(f.config,async()=>raw(),()=>({
  async sendMail(m){serialized=(await nodemailer.createTransport({streamTransport:true,buffer:true}).sendMail(m)).message;return {accepted:[m.to],rejected:[]};},
  close(){}
 }));
 await s.reply_mail({uid:1,uidValidity:'42',expectedRecipient:'ticket@example.invalid',expectedMessageId:'<original@example.invalid>',text:'Ок',idempotencyKey:input.idempotencyKey});
 const parsed=await simpleParser(serialized);
 assert.equal(parsed.text.trim(),'Ок');assert.equal(parsed.subject,'Re: Тикет');assert.equal(parsed.inReplyTo,'<original@example.invalid>');assert.equal(parsed.from.value[0].address,env.MAILRU_USER);assert.equal(parsed.to.value[0].address,'ticket@example.invalid');
});
