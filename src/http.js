import { createServer as createNodeServer } from 'node:http';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { loadHttpConfig, createAuthenticator, unauthorized } from './http-auth.js';

// Injectable factory lets offline tests prove no mailbox work occurs before authentication.
export function createHttpHandler(config, serverFactory, authenticate = createAuthenticator(config)) {
  let inFlight = 0;
  return async (request) => {
    const url = new URL(request.url);
    if (request.headers.get('host') !== config.host || (request.headers.has('origin') && request.headers.get('origin') !== config.origin)) return new Response('Forbidden', { status: 403 });
    if (url.pathname === '/.well-known/oauth-protected-resource/mcp' && request.method === 'GET') {
      return Response.json({ resource: config.resource, authorization_servers: [config.issuer], scopes_supported: [config.scope] });
    }
    if (url.pathname !== '/mcp' || url.search) return new Response('Not found', { status: 404 });
    try { await authenticate(request.headers.get('authorization')); } catch { return unauthorized(config); }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    if (inFlight >= 4) return new Response('Busy', { status: 429, headers: { 'Retry-After': '5' } });
    inFlight++;
    let server;
    try {
      server = serverFactory();
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 65536 });
      await server.connect(transport);
      const result = await transport.handleRequest(request);
      // Materialize JSON before closing this stateless request's transport.
      const body = await result.arrayBuffer();
      const headers = new Headers(result.headers);
      headers.set('Cache-Control', 'no-store');
      return new Response(body.byteLength ? body : null, { status: result.status, headers });
    } catch { return new Response('Request failed', { status: 500 }); }
    finally { inFlight--; await server?.close().catch(() => {}); }
  };
}
export async function startHttp(env = process.env) {
  const config = loadHttpConfig(env);
  const [{ createServer }, { loadConfig }, { MailService }] = await Promise.all([import('./server.js'), import('./config.js'), import('./mail.js')]);
  const service = new MailService(loadConfig(env));
  const handler = createHttpHandler(config, () => createServer(service));
  const server = createNodeServer(async (req, res) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value);
      const request = new Request(`${config.origin}${req.url}`, { method: req.method, headers,
        ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Readable.toWeb(req), duplex: 'half' }) });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500); res.end('Request failed'); }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 30000;
  server.maxConnections = 32;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', resolve); });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHttp().catch(() => { process.stderr.write('HTTP startup failed: verify required configuration.\n'); process.exitCode = 1; });
}
