import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createSmtpTransport} from '../src/smtp.js';

function fixture() {
 const socket=new EventEmitter();
 socket.authorized=true;socket.destroyed=false;
 socket.destroy=()=>{socket.destroyed=true;socket.emit('close');};
 let settings,tlsSettings,callbackCalls=0,connections=0,closed=0,handedOff=0;
 const transport=createSmtpTransport({auth:{user:'synthetic',pass:'synthetic'},host:'override.invalid',tls:{rejectUnauthorized:false}},{
  connect(options){connections++;tlsSettings=options;return socket;},
  createTransport(options){
   settings=options;
   return {
    sendMail(){return new Promise((resolve,reject)=>{
     options.getSocket({},(err,result)=>{
      callbackCalls++;
      if(err){reject(err);return;}
      handedOff++;resolve(result);
     });
    });},
    close(){closed++;}
   };
  }
 });
 return {socket,transport,get settings(){return settings;},get tlsSettings(){return tlsSettings;},
  get callbackCalls(){return callbackCalls;},get connections(){return connections;},
  get closed(){return closed;},get handedOff(){return handedOff;}};
}

test('SMTP wrapper owns verified Mail.ru TLS socket and marks it already secured',async()=>{
 const f=fixture();const promise=f.transport.sendMail({});
 assert.equal(f.tlsSettings.host,'smtp.mail.ru');assert.equal(f.tlsSettings.port,465);
 assert.equal(f.tlsSettings.servername,'smtp.mail.ru');assert.equal(f.tlsSettings.rejectUnauthorized,true);
 assert.equal(f.tlsSettings.minVersion,'TLSv1.2');assert.equal(f.settings.forceAuth,true);
 assert.equal(f.settings.pool,false);assert.equal(f.settings.logger,false);
 f.socket.emit('secureConnect');const result=await promise;
 assert.equal(result.connection,f.socket);assert.equal(result.secured,true);
 f.transport.close();assert.equal(f.socket.destroyed,true);
});
test('cancel during TLS destroys socket, rejects pending call, ignores late secureConnect',async()=>{
 const f=fixture();const promise=f.transport.sendMail({});
 f.transport.close();
 await assert.rejects(promise,/SOCKET_CLOSED|CANCELED/);
 f.socket.emit('secureConnect');f.socket.emit('error',new Error('late failure'));
 assert.equal(f.socket.destroyed,true);assert.equal(f.callbackCalls,1);assert.equal(f.handedOff,0);
 await assert.rejects(f.transport.sendMail({}),/CLOSED/);
 assert.equal(f.connections,1);
});
test('cancel after handoff destroys active socket despite non-pooled transport close being a no-op',async()=>{
 const f=fixture();const promise=f.transport.sendMail({});f.socket.emit('secureConnect');await promise;
 f.transport.close();assert.equal(f.socket.destroyed,true);assert.equal(f.closed,1);assert.equal(f.callbackCalls,1);
});
test('close before first send prevents opening any connection',async()=>{
 const f=fixture();f.transport.close();await assert.rejects(f.transport.sendMail({}),/CLOSED/);assert.equal(f.connections,0);
});
test('certificate failure never hands socket to SMTP, provider details not exposed',async()=>{
 const f=fixture();f.socket.authorized=false;const promise=f.transport.sendMail({});
 f.socket.emit('secureConnect');await assert.rejects(promise,/SOCKET_CLOSED|TLS_FAILED/);
 assert.equal(f.socket.destroyed,true);assert.equal(f.handedOff,0);
});
test('TLS socket error resolves once without subsequent handoff',async()=>{
 const f=fixture();const promise=f.transport.sendMail({});
 f.socket.emit('error',new Error('sensitive error'));await assert.rejects(promise,/^Error: SMTP_TLS_FAILED$/);
 f.socket.emit('secureConnect');assert.equal(f.callbackCalls,1);assert.equal(f.handedOff,0);f.transport.close();
});
test('one transport cannot open a second connection',async()=>{
 const f=fixture();const first=f.transport.sendMail({});f.socket.emit('secureConnect');await first;
 await assert.rejects(f.transport.sendMail({}),/CLOSED/);assert.equal(f.connections,1);f.transport.close();
});
test('real Nodemailer uses owned TLS socket for authenticated SMTP submission (offline)',async()=>{
 const {Duplex}=await import('node:stream');
 const commands=[];let inData=false,data='';
 const socket=new Duplex({
  read(){},
  write(chunk,_encoding,callback){
   const line=chunk.toString();commands.push(line);
   const respond=s=>setImmediate(()=>this.push(s+'\r\n'));
   if(inData){
    data+=line;
    if(data.endsWith('\r\n.\r\n')) {inData=false;respond('250 queued synthetic');}
   } else if(line.startsWith('EHLO ')) respond('250-synthetic\r\n250 AUTH PLAIN');
   else if(line.startsWith('AUTH PLAIN ')) respond('235 authenticated');
   else if(line.startsWith('MAIL FROM:')) respond('250 sender');
   else if(line.startsWith('RCPT TO:')) respond('250 recipient');
   else if(line==='DATA\r\n') {inData=true;respond('354 send data');}
   callback();
  }
 });
 socket.authorized=true;socket.encrypted=true;
 socket.setTimeout=()=>socket;socket.setKeepAlive=()=>socket;
 const transport=createSmtpTransport({auth:{user:'fixture@mail.ru',pass:'synthetic-test-only'},connectionTimeout:1000,greetingTimeout:1000,socketTimeout:1000},{
  connect(){setImmediate(()=>{socket.emit('secureConnect');setImmediate(()=>socket.push('220 synthetic SMTP\r\n'));});return socket;}
 });
 try {
  const result=await transport.sendMail({from:'fixture@mail.ru',to:'recipient@example.invalid',subject:'Test',text:'Ок'});
  assert.deepEqual(result.accepted,['recipient@example.invalid']);
  assert.ok(commands.some(x=>x.startsWith('AUTH PLAIN ')));
  assert.match(data,/Content-Type: text\/plain/);
 } finally {transport.close();}
 assert.equal(socket.destroyed,true);
});
