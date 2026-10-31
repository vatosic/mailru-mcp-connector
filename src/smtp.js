import tls from 'node:tls';
import nodemailer from 'nodemailer';

// Nodemailer's non-pooled transport.close() does not close an active SMTP socket.
// Own that socket so the service's absolute deadline really cancels network work.
export function createSmtpTransport(options, dependencies = {}) {
 const connect = dependencies.connect || (o => tls.connect(o));
 const makeTransport = dependencies.createTransport || (o => nodemailer.createTransport(o));
 const tlsOptions = {host:'smtp.mail.ru',port:465,servername:'smtp.mail.ru',
  rejectUnauthorized:true,minVersion:'TLSv1.2'};
 let socket, pending, canceled=false, started=false;
 const transport = makeTransport({...options,host:tlsOptions.host,port:465,secure:true,pool:false,
  forceAuth:true,tls:{servername:tlsOptions.servername,rejectUnauthorized:true,minVersion:'TLSv1.2'},
  logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true,
  getSocket(_ignored, callback) {
   if(canceled || started) {callback(new Error('SMTP_TRANSPORT_CLOSED'));return;}
   started=true;
   let settled=false;
   const done=(error,result)=>{
    if(settled) return;
    settled=true;pending=undefined;
    callback(error,result);
   };
   pending=()=>done(new Error('SMTP_CANCELED'));
   try {
    socket=connect(tlsOptions);
    socket.on('error',()=>done(new Error('SMTP_TLS_FAILED')));
    socket.once('close',()=>done(new Error('SMTP_SOCKET_CLOSED')));
    socket.once('secureConnect',()=>{
     if(canceled || socket.destroyed || socket.authorized!==true) {
      socket.destroy();done(new Error('SMTP_TLS_FAILED'));return;
     }
     done(null,{connection:socket,secured:true});
    });
   } catch {done(new Error('SMTP_TLS_FAILED'));}
  }
 });
 return {
  sendMail(message) {
   if(canceled) return Promise.reject(new Error('SMTP_TRANSPORT_CLOSED'));
   return transport.sendMail(message);
  },
  close() {
   canceled=true;
   // Destroy first: even if the callback throws, no connection can continue.
   try {socket?.destroy();} finally {
    try {pending?.();} finally {transport.close();}
   }
  }
 };
}
