import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './config.js';
import { MailService } from './mail.js';
import { createServer } from './server.js';
try {
 const service = new MailService(loadConfig());
 await serveStdio(() => createServer(service), {onerror:()=>{}});
} catch { process.stderr.write('Startup failed: check private Mail.ru configuration.\n'); process.exitCode=1; }
