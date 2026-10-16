from contextlib import closing
from copy import deepcopy
import io
import json
import os
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch
import deploy
from package import package

REV = 'a' * 40
ROOT = Path(__file__).resolve().parents[2]


class BotDeploy(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bot = self.root / 'bot'
        for name in ['src', 'test', 'node_modules/discord.js', 'scripts/deploy']:
            (self.bot / name).mkdir(parents=True, exist_ok=True)
        for name in ['LICENSE', 'package.json', 'package-lock.json', 'src/index.js', 'node_modules/discord.js/package.json']:
            (self.bot / name).write_text('{}')
        (self.bot / 'package.json').write_text('{"type":"module"}')
        for name in ['store.js', 'xp.js']:
            (self.bot / 'src' / name).write_bytes((ROOT / 'src' / name).read_bytes())
        self.unit = self.root / 'unit'
        self.unit.write_text('existing service config')
        (self.bot / 'scripts/deploy/openrotmg-discord-bot.service').write_bytes(self.unit.read_bytes())
        self.archive = self.root / 'bot.tar.gz'
        package(self.bot, REV, self.archive)
        self.raw = self.archive.read_bytes()
        self.live = self.root / 'live'
        self.live.mkdir()
        (self.live / 'REVISION').write_text('b' * 40)
        self.db = self.root / 'levels.sqlite'
        with closing(sqlite3.connect(self.db)) as db, db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('CREATE TABLE levels(guild_id TEXT,user_id TEXT,username TEXT,xp INTEGER,last_xp_at INTEGER,last_message_id TEXT,PRIMARY KEY(guild_id,user_id));')
            db.execute('INSERT INTO levels VALUES (?,?,?,?,?,?)', ('guild', 'user', 'Player', 100, 123, '456'))
        for name, value in [('LIVE', self.live), ('STATE', self.root / 'state'), ('DATABASE', self.db), ('UNIT', self.unit)]:
            p = patch.object(deploy, name, value)
            p.start()
            self.addCleanup(p.stop)

    def rewrite(self, transform):
        with tarfile.open(fileobj=io.BytesIO(self.raw)) as archive:
            entries = [(e, archive.extractfile(e).read()) for e in archive]
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode='w:gz') as archive:
            for entry, data in transform(entries):
                entry.size = len(data)
                archive.addfile(entry, io.BytesIO(data))
        return output.getvalue()

    def test_package_roundtrip_and_bot_only_exchange_preserves_saved_data(self):
        before = deploy.snapshot(self.db)
        health = {'ready': {}, 'heartbeat': {}, 'updates_synced': {}}
        def field(service, key):
            return {'ActiveState': 'inactive' if field.stopped else 'active', 'Result': 'success', 'MainPID': '42', 'InvocationID': 'invocation'}[key]
        field.stopped = False
        def run(*args, **kwargs):
            field.stopped = args[1] == 'stop'
        with patch.object(deploy, 'current_main'), patch.object(deploy, 'rehearse'), patch.object(deploy, 'field', side_effect=field), \
                patch.object(deploy, 'run', side_effect=run) as commands, patch.object(deploy, 'ready', return_value=health):
            deploy.deploy(REV, self.raw)
        self.assertEqual([c.args for c in commands.call_args_list], [('systemctl', 'stop', deploy.SERVICE), ('systemctl', 'start', deploy.SERVICE)])
        _, manifest = deploy.payload(self.raw, REV)
        self.assertEqual(deploy.files(self.live), manifest)
        status = json.loads((deploy.STATE / 'status.json').read_text())
        self.assertEqual(status['state'], 'deployed')
        self.assertEqual(deploy.snapshot(self.db), before)
        self.assertEqual(deploy.snapshot(Path(status['recovery']) / 'before-levels.sqlite'), before)
        self.assertEqual((Path(status['previous_bot']) / 'REVISION').read_text(), 'b' * 40)
        with patch.object(deploy, 'current_main'), patch.object(deploy, 'field', side_effect=field), \
                patch.object(deploy, 'run') as commands, patch.object(deploy, 'ready', return_value=health):
            deploy.deploy(REV, self.raw)
            commands.assert_not_called()

    def test_failed_startup_retains_previous_source_and_frozen_database_without_rollback(self):
        def field(service, key):
            return 'inactive' if key == 'ActiveState' and field.stopped else 'success' if key == 'Result' else 'active'
        field.stopped = False
        def run(*args, **kwargs):
            field.stopped = args[1] == 'stop'
        before = deploy.snapshot(self.db)
        with patch.object(deploy, 'current_main'), patch.object(deploy, 'rehearse'), patch.object(deploy, 'field', side_effect=field), \
                patch.object(deploy, 'run', side_effect=run), patch.object(deploy, 'ready', side_effect=TimeoutError('not ready')):
            with self.assertRaisesRegex(TimeoutError, 'not ready'):
                deploy.deploy(REV, self.raw)
        status = json.loads((deploy.STATE / 'status.json').read_text())
        self.assertEqual(status['state'], 'activated_unverified')
        self.assertEqual((self.live / 'REVISION').read_text().strip(), REV)
        self.assertEqual((Path(status['previous_bot']) / 'REVISION').read_text(), 'b' * 40)
        self.assertEqual(deploy.snapshot(Path(status['recovery']) / 'before-levels.sqlite'), before)

    def test_archive_paths_links_duplicates_checksums_and_revision_fail_closed(self):
        for name in ['/etc/evil', 'bot/../../evil', 'bot//evil']:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'Unsafe'):
                deploy.payload(self.rewrite(lambda entries: entries + [(tarfile.TarInfo(name), b'evil')]), REV)
        def symlink(entries):
            entry = tarfile.TarInfo('bot/link')
            entry.type = tarfile.SYMTYPE
            entry.linkname = '/etc/shadow'
            return entries + [(entry, b'')]
        for transform in [symlink, lambda entries: entries + [deepcopy(entries[0])]]:
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                deploy.payload(self.rewrite(transform), REV)
        with self.assertRaisesRegex(ValueError, 'checksum'):
            deploy.payload(self.rewrite(lambda entries: [(e, b'wrong' if e.name == 'bot/src/index.js' else d) for e, d in entries]), REV)
        with self.assertRaisesRegex(ValueError, 'revision'):
            deploy.payload(self.raw, 'b' * 40)
        with patch.object(deploy, 'LIMIT', len(self.raw) - 1), self.assertRaisesRegex(ValueError, 'archive exceeds'):
            deploy.payload(self.raw, REV)
        with patch.object(deploy, 'LIMIT', 8192), self.assertRaisesRegex(ValueError, 'expanded content exceeds'):
            deploy.payload(self.raw, REV)

    def test_stale_main_unit_changes_and_rehearsal_failure_never_stop_the_bot(self):
        with patch.object(deploy, 'current_main', side_effect=ValueError('Main advanced')), patch.object(deploy, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'Main advanced'):
                deploy.deploy(REV, self.raw)
            run.assert_not_called()
        with patch.object(deploy, 'current_main'), patch.object(deploy, 'field', return_value='active'), \
                patch.object(deploy, 'rehearse', side_effect=ValueError('rehearsal failed')), patch.object(deploy, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'rehearsal failed'):
                deploy.deploy(REV, self.raw)
            run.assert_not_called()
        self.unit.write_text('unreviewed unit change')
        with self.assertRaisesRegex(ValueError, 'Service configuration changed'):
            deploy.payload(self.raw, REV)

    def test_candidate_store_opens_a_real_copy_without_changing_progress(self):
        before = deploy.snapshot(self.db)
        def unprivileged(*args, **kwargs):
            return deploy.subprocess.run(args[4:], check=True, **kwargs)
        uid = types.SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid())
        with patch.object(deploy, 'run', side_effect=unprivileged), patch.object(deploy.pwd, 'getpwnam', return_value=uid), \
                patch.object(deploy.os, 'chown', wraps=os.chown) as chown:
            deploy.rehearse(self.bot)
        self.assertTrue({'levels.sqlite-wal', 'levels.sqlite-shm'} <= {call.args[0].name for call in chown.call_args_list})
        self.assertEqual(deploy.snapshot(self.db), before)
        with closing(sqlite3.connect(self.db)) as db, db:
            db.execute('ALTER TABLE levels ADD COLUMN unsupported TEXT')
        with self.assertRaisesRegex(ValueError, 'backup contract first'):
            deploy.snapshot(self.db)

    def test_readiness_requires_this_invocations_identity_gateway_and_sync(self):
        entries = [{'event': 'ready', 'botId': deploy.BOT_ID, 'guildId': deploy.GUILD_ID},
                   {'event': 'heartbeat', 'gatewayStatus': 0}, {'event': 'updates_synced', 'posts': 4}]
        with patch.object(deploy, 'field', side_effect=lambda _, k: 'active' if k == 'ActiveState' else 'invocation'), \
                patch.object(deploy.subprocess, 'check_output', return_value='\n'.join(map(json.dumps, entries))):
            self.assertEqual(deploy.ready('invocation')['updates_synced']['posts'], 4)
            with self.assertRaisesRegex(ValueError, 'exited/restarted'):
                deploy.ready('other-invocation')
        entries.append({'event': 'updates_sync_failed'})
        with patch.object(deploy, 'field', side_effect=lambda _, k: 'active' if k == 'ActiveState' else 'invocation'), \
                patch.object(deploy.subprocess, 'check_output', return_value='\n'.join(map(json.dumps, entries))):
            with self.assertRaisesRegex(ValueError, 'readiness failed'):
                deploy.ready('invocation')


if __name__ == '__main__':
    unittest.main()
