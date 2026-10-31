#!/usr/bin/env python3
"""Bridge systemd credential ACLs to the application's strict 0600 contract."""
import os
import stat
import sys
import tempfile
from pathlib import Path


def main(mode):
    if mode not in ('stdio', 'http'):
        raise ValueError('unsupported transport')
    node = os.environ.get('NODE_BINARY', '/usr/bin/node')
    if not Path(node).is_absolute():
        raise ValueError('absolute Node executable required')
    directory = Path(os.environ['RUNTIME_DIRECTORY'])
    st = directory.lstat()
    if not directory.is_absolute() or not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o700:
        raise ValueError('private runtime directory required')
    source = Path(os.environ['CREDENTIALS_DIRECTORY']) / 'mailru-password'
    if not stat.S_ISREG(source.lstat().st_mode):
        raise ValueError('regular credential required')
    with source.open('rb') as handle:
        secret = handle.read(4097)
    if not secret or len(secret) > 4096:
        raise ValueError('invalid credential size')
    fd, temporary = tempfile.mkstemp(prefix='.mailru-', dir=directory)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(secret)
            handle.flush()
            os.fsync(handle.fileno())
        target = directory / 'mailru-password'
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    del secret
    env = dict(os.environ)
    env.pop('MAILRU_APP_PASSWORD', None)
    env['MAILRU_PASSWORD_FILE'] = str(target)
    env.setdefault('MAILRU_SEND_ENABLED', 'false')
    env['MAILRU_ENABLE_HTTP'] = 'true' if mode == 'http' else 'false'
    entry = Path(__file__).resolve().parent.parent / 'src' / ('http.js' if mode == 'http' else 'index.js')
    os.execve(node, [node, str(entry)], env)


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('one transport argument required')
        main(sys.argv[1])
    except Exception:
        print('Private Mail.ru startup failed; check local configuration.', file=sys.stderr)
        sys.exit(1)
