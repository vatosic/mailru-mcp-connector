import { isAbsolute } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
export function loadConfig(env = process.env) {
  const user = env.MAILRU_USER;
  if (!user || !/^[^\s@]+@(mail\.ru|inbox\.ru|list\.ru|bk\.ru|internet\.ru)$/i.test(user)) throw new Error('CONFIG: valid Mail.ru address required');
  if (!!env.MAILRU_APP_PASSWORD === !!env.MAILRU_PASSWORD_FILE) throw new Error('CONFIG: provide exactly one password source');
  let password = env.MAILRU_APP_PASSWORD;
  if (env.MAILRU_PASSWORD_FILE) {
    const stat = statSync(env.MAILRU_PASSWORD_FILE);
    if (!stat.isFile() || stat.size > 4096 || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('CONFIG: secret file must be private (0600) and small');
    password = readFileSync(env.MAILRU_PASSWORD_FILE, 'utf8').trim();
  }
  if (!password || password.length > 4096 || /[\r\n\0]/.test(password) || password.includes('REPLACE_')) throw new Error('CONFIG: app password required');
  let folders;
  try { folders = JSON.parse(env.MAILRU_FOLDERS_JSON || '["INBOX"]'); } catch { throw new Error('CONFIG: folders must be JSON'); }
  if (!Array.isArray(folders) || !folders.length || folders.length > 20 || folders.some(x => typeof x !== 'string' || !x.length || x.length > 200 || /[\x00-\x1f\x7f]/.test(x))) throw new Error('CONFIG: invalid folder allowlist');
  if (env.MAILRU_SEND_ENABLED && !['true','false'].includes(env.MAILRU_SEND_ENABLED)) throw new Error('CONFIG: invalid send switch');
  const sendEnabled = env.MAILRU_SEND_ENABLED === 'true';
  const sendStateDir = env.MAILRU_SEND_STATE_DIR;
  if (sendEnabled && (!sendStateDir || !isAbsolute(sendStateDir))) throw new Error('CONFIG: private absolute send state directory required');
  return Object.freeze({ user, password, sendEnabled, sendStateDir, folders: Object.freeze([...new Set(folders)]) });
}
