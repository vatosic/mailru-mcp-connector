import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { McpServer } from '@modelcontextprotocol/server';
import { loadHttpConfig, createAuthenticator } from '../src/http-auth.js';
import { createHttpHandler, startHttp } from '../src/http.js';
const env = { MAILRU_ENABLE_HTTP: 'true', MCP_RESOURCE: 'https://mail.example.test/mcp', MCP_ISSUER: 'https://identity.example.test', MCP_JWKS_URI: 'https://identity.example.test/jwks', MCP_OWNER_SUBJECT: 'offline-test-owner' };
const config = loadHttpConfig(env);
test('read-only HTTP scope cannot enable sending, before credentials or a listener are created', async () => {
  const unsafe={...env,MAILRU_SEND_ENABLED:'true',MAILRU_PASSWORD_FILE:'/does-not-exist'};
  assert.throws(()=>loadHttpConfig(unsafe),/HTTP sending is not supported/);
  await assert.rejects(startHttp(unsafe),/HTTP sending is not supported/);
});
const { publicKey, privateKey } = await generateKeyPair('RS256');
const authenticate = createAuthenticator(config, publicKey);
async function token(overrides = {}, key = privateKey) {
  return new SignJWT({ scope: 'mail:read', iss: config.issuer, aud: config.resource, sub: config.owner, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+60, ...overrides }).setProtectedHeader({ alg: 'RS256' }).sign(key);
}
test('HTTP requires explicit opt-in and complete validated configuration', () => {
  assert.throws(() => loadHttpConfig({}));
  for (const key of ['MCP_RESOURCE','MCP_ISSUER','MCP_JWKS_URI','MCP_OWNER_SUBJECT']) assert.throws(() => loadHttpConfig({ ...env, [key]: '' }));
  for (const change of [{MCP_RESOURCE:'http://mail.example.test/mcp'}, {MCP_RESOURCE:'https://mail.example.test/other'}, {MCP_JWKS_URI:'https://other.test/jwks'}, {MCP_PORT:'0'}, {MCP_OWNER_SUBJECT:'x\r\ny'}]) assert.throws(() => loadHttpConfig({...env,...change}));
  assert.equal(config.issuer, env.MCP_ISSUER);
});
test('JWT checks signature, issuer, audience, expiration, required claims, owner and scope', async () => {
  assert.deepEqual(await authenticate(`Bearer ${await token()}`), { subject: config.owner });
  for (const change of [{iss:'https://wrong.test'}, {aud:'other'}, {exp:1}, {exp:undefined}, {iat:undefined}, {sub:'other'}, {scope:'mail:write'}, {scope:undefined}, {nbf:Math.floor(Date.now()/1000)+60}]) await assert.rejects(authenticate(`Bearer ${await token(change)}`));
  const wrong = await generateKeyPair('RS256');
  await assert.rejects(authenticate(`Bearer ${await token({}, wrong.privateKey)}`));
  for (const header of [null,'','Bearer nope','Basic test','Bearer a.b.c\r\n']) await assert.rejects(authenticate(header));
});
function req(path='/mcp', options={}) {
  return new Request(`https://mail.example.test${path}`, { ...options, headers: {host:config.host, ...options.headers} });
}
test('metadata is public; unauthenticated endpoint never constructs MCP/mail service', async () => {
  let calls=0;
  const handler=createHttpHandler(config,()=>{ calls++; throw Error('must not run'); },authenticate);
  const metadata=await handler(req('/.well-known/oauth-protected-resource/mcp'));
  assert.equal(metadata.status,200);
  assert.deepEqual((await metadata.json()).authorization_servers,[config.issuer]);
  const response=await handler(req());
  assert.equal(response.status,401);
  assert.match(response.headers.get('www-authenticate'),/oauth-protected-resource\/mcp/);
  assert.equal((await handler(req('/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'read_mail',arguments:{}}})}))).status,401);
  assert.equal(calls,0);
  assert.equal((await handler(req('/mcp',{headers:{host:'attacker.test'}}))).status,403);
  assert.equal((await handler(req('/mcp',{headers:{origin:'https://attacker.test'}}))).status,403);
});
test('authenticated stateless MCP initialization and request size bounds', async () => {
  const handler=createHttpHandler(config,()=>new McpServer({name:'offline-test',version:'1.0.0'}),authenticate);
  const headers={authorization:`Bearer ${await token()}`,'content-type':'application/json',accept:'application/json, text/event-stream'};
  const result=await handler(req('/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}})}));
  assert.equal(result.status,200);
  assert.equal((await result.json()).result.serverInfo.name,'offline-test');
  assert.equal(result.headers.get('cache-control'),'no-store');
  assert.equal((await handler(req('/mcp',{headers}))).status,405);
  assert.equal((await handler(req('/mcp',{method:'POST',headers,body:'x'.repeat(65537)}))).status,413);
});
