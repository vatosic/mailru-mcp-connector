import importlib.util
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parent.parent / 'scripts' / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


store = module('store-app-password')
bridge = module('run-with-systemd-credential')


@unittest.skipUnless(os.name == 'posix', 'POSIX permissions required')
class PrivateHelpers(unittest.TestCase):
    def test_store_private_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'credential'
            store.store(p, 'synthetic-only')
            self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o600)
            with self.assertRaises(FileExistsError):
                store.store(p, 'replacement-not-written')
            self.assertEqual(p.read_text(), 'synthetic-only')

    def test_insecure_parent_and_symlinks_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            parent = Path(d) / 'directory'
            parent.mkdir(mode=0o755)
            with self.assertRaises(ValueError):
                store.store(parent / 'secret', 'synthetic-only')
            parent.chmod(0o700)
            alias = Path(d) / 'alias'
            alias.symlink_to(parent, target_is_directory=True)
            with self.assertRaises(ValueError):
                store.store(alias / 'secret', 'synthetic-only')
            (parent / 'secret').symlink_to(parent / 'missing')
            with self.assertRaises(FileExistsError):
                store.store(parent / 'secret', 'synthetic-only')
            self.assertFalse((parent / 'missing').exists())

    def test_invalid_secret_never_creates_file(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'secret'
            for bad in ['', 'a\nb', 'x' * 4097]:
                with self.assertRaises(ValueError):
                    store.store(p, bad)
                self.assertFalse(p.exists())

    def test_systemd_acl_bridge_keeps_runtime_private_and_sending_default_off(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            runtime = root / 'runtime'
            credentials = root / 'credentials'
            runtime.mkdir(mode=0o700)
            credentials.mkdir(mode=0o700)
            source = credentials / 'mailru-password'
            source.write_text('synthetic-only')
            source.chmod(0o440)
            env = {'RUNTIME_DIRECTORY':str(runtime), 'CREDENTIALS_DIRECTORY':str(credentials), 'NODE_BINARY':'/synthetic/node', 'MAILRU_USER':'fixture@mail.ru', 'MAILRU_APP_PASSWORD':'must-be-removed'}
            with patch.dict(os.environ, env, clear=True), patch.object(bridge.os, 'execve') as execute:
                bridge.main('stdio')
                command, args, child_env = execute.call_args.args
            self.assertEqual(command, '/synthetic/node')
            self.assertTrue(args[1].endswith('/src/index.js'))
            self.assertEqual(child_env['MAILRU_SEND_ENABLED'], 'false')
            self.assertEqual(child_env['MAILRU_ENABLE_HTTP'], 'false')
            self.assertNotIn('MAILRU_APP_PASSWORD', child_env)
            target = Path(child_env['MAILRU_PASSWORD_FILE'])
            self.assertEqual(target.read_text(), 'synthetic-only')
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            runtime.chmod(0o755)
            with patch.dict(os.environ, env, clear=True), self.assertRaises(ValueError):
                bridge.main('stdio')


if __name__ == '__main__':
    unittest.main()
