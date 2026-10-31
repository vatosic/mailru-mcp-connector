#!/usr/bin/env python3
"""Owner-run hidden input. No network, overwrite, shell echo or secret output."""
import getpass
import os
import stat
import sys
import warnings
from pathlib import Path


def store(path, secret):
    path = Path(path).expanduser().absolute()
    parent = path.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or stat.S_IMODE(parent.st_mode) != 0o700:
        raise ValueError('private owner directory required')
    encoded = secret.strip().encode('utf-8')
    if not encoded or len(encoded) > 4096 or any(c < 32 or c == 127 for c in encoded):
        raise ValueError('invalid application password')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as target:
            target.write(encoded)
            target.flush()
            os.fsync(target.fileno())
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def main():
    if os.name != 'posix' or len(sys.argv) != 2 or not sys.stdin.isatty():
        raise ValueError('one output path and interactive POSIX terminal required')
    path = Path(sys.argv[1]).expanduser().absolute()
    if path.exists() or path.is_symlink():
        raise ValueError('output already exists')
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        secret = getpass.getpass('Mail.ru application password (hidden): ')
    store(path, secret)
    del secret
    print('Application password stored privately; value not displayed.')


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt):
        print('Not stored: check private directory, unused path and terminal input.', file=sys.stderr)
        sys.exit(1)
