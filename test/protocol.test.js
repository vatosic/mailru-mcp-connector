import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
test('actual stdio SDK negotiation lists only read-only tools; rejects hostile args offline',async()=>{
 const transport=new StdioClientTransport({command:process.execPath,args:['src/index.js'],env:{MAILRU_USER:'fixture@mail.ru',MAILRU_APP_PASSWORD:'synthetic-test-only'},stderr:'pipe'});
 const client=new Client({name:'offline-test',version:'1.0.0'});
 try {await client.connect(transport);const {tools}=await client.listTools();assert.deepEqual(tools.map(x=>x.name).sort(),['list_folders','read_mail','search_mail']);assert.ok(tools.every(x=>x.annotations.readOnlyHint));
 const r=await client.callTool({name:'search_mail',arguments:{folder:'INBOX',host:'evil.invalid'}});assert.equal(r.isError,true);
 } finally {await client.close();}
});

import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('enabled stdio advertises write tools as destructive; status never connects to mail',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mailru-protocol-'));
 const transport=new StdioClientTransport({command:process.execPath,args:['src/index.js'],env:{MAILRU_USER:'fixture@mail.ru',MAILRU_APP_PASSWORD:'synthetic-test-only',MAILRU_SEND_ENABLED:'true',MAILRU_SEND_STATE_DIR:dir},stderr:'pipe'});
 const client=new Client({name:'offline-send-test',version:'1.0.0'});
 try {
  await client.connect(transport);const {tools}=await client.listTools();
  assert.equal(tools.length,7);
  for(const name of ['send_mail','reply_mail']) {const t=tools.find(x=>x.name===name);assert.equal(t.annotations.readOnlyHint,false);assert.equal(t.annotations.destructiveHint,true);}
  const result=await client.callTool({name:'send_status',arguments:{idempotencyKey:'offline_status_key_1'}});
  assert.equal(JSON.parse(result.content[0].text).data.status,'not_found');
  assert.equal((await client.callTool({name:'send_mail',arguments:{to:'a@example.invalid\nBcc:b@example.invalid'}})).isError,true);
 } finally {await client.close();rmSync(dir,{recursive:true,force:true});}
});
