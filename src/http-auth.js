import { createRemoteJWKSet, jwtVerify } from 'jose';

const required = (env, key) => {
  const value = env[key];
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) throw new Error(`Invalid ${key}`);
  return value;
};
function httpsUrl(env, key) {
  const value = required(env, key);
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error(`Invalid ${key}`);
  return url;
}
export function loadHttpConfig(env = process.env) {
  if (env.MAILRU_ENABLE_HTTP !== 'true') throw new Error('HTTP disabled; explicit opt-in required');
  // This transport authorizes mail:read only. Never expose SMTP under that scope.
  if (env.MAILRU_SEND_ENABLED === 'true') throw new Error('HTTP sending is not supported; use owner-isolated stdio');
  const resource = httpsUrl(env, 'MCP_RESOURCE');
  if (resource.pathname !== '/mcp') throw new Error('MCP_RESOURCE must end in /mcp');
  const issuer = httpsUrl(env, 'MCP_ISSUER');
  const jwks = httpsUrl(env, 'MCP_JWKS_URI');
  // A fixed same-origin JWKS endpoint avoids discovery URLs controlled by clients.
  if (jwks.origin !== issuer.origin) throw new Error('JWKS must use issuer origin');
  const owner = required(env, 'MCP_OWNER_SUBJECT');
  const port = Number(env.MCP_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid MCP_PORT');
  return Object.freeze({ resource: resource.href, issuer: env.MCP_ISSUER, jwks: jwks.href, owner, port,
    host: resource.host, origin: resource.origin, scope: 'mail:read',
    metadataUrl: `${resource.origin}/.well-known/oauth-protected-resource/mcp` });
}
export function createAuthenticator(config, keyResolver) {
  const keys = keyResolver ?? createRemoteJWKSet(new URL(config.jwks), { timeoutDuration: 5000, cooldownDuration: 30000 });
  return async (header) => {
    if (typeof header !== 'string' || header.length > 16384 || !/^Bearer [A-Za-z0-9_.-]+$/.test(header)) throw new Error('Unauthorized');
    const { payload } = await jwtVerify(header.slice(7), keys, {
      algorithms: ['RS256', 'ES256'], issuer: config.issuer, audience: config.resource,
      requiredClaims: ['exp', 'iat', 'sub'], clockTolerance: 5,
    });
    if (payload.sub !== config.owner || typeof payload.scope !== 'string' || !payload.scope.split(' ').includes(config.scope)) throw new Error('Unauthorized');
    return { subject: payload.sub };
  };
}
export function unauthorized(config) {
  return new Response('Unauthorized', { status: 401, headers: {
    'WWW-Authenticate': `Bearer resource_metadata="${config.metadataUrl}", scope="${config.scope}"`,
    'Cache-Control': 'no-store',
  } });
}
