#!/usr/bin/python3 -I
import ctypes
import fcntl
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
from contextlib import closing

LIVE = Path('/opt/openrotmg-discord-bot')
STATE = Path('/var/lib/openrotmg-bot-deploy')
DATABASE = Path('/var/lib/openrotmg-discord-bot/levels.sqlite')
UNIT = Path('/etc/systemd/system/openrotmg-discord-bot.service')
LOCK = Path('/run/lock/openrotmg-deploy.lock')
REPO = 'https://github.com/OpenRotMG/Open-RotMG-Discord-Bot.git'
SERVICE = 'openrotmg-discord-bot'
LIMIT = 64 * 1024 * 1024
BOT_ID = '1558885888400818247'
GUILD_ID = '1558662335076376578'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def field(service, name):
    return subprocess.check_output(['systemctl', 'show', service, '-p', name, '--value'], text=True).strip()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def files(root):
    require(not any(p.is_symlink() for p in root.rglob('*')), 'Bot tree contains a symlink')
    return {str(p.relative_to(root)): digest(p.read_bytes()) for p in root.rglob('*') if p.is_file()}


def payload(raw, revision):
    require(len(raw) <= LIMIT, 'Bot archive exceeds 64 MiB')
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as compressed:
        expanded = compressed.read(LIMIT + 1)
    require(len(expanded) <= LIMIT, 'Bot archive expanded content exceeds 64 MiB')
    result = {}
    with tarfile.open(fileobj=io.BytesIO(expanded), mode='r:') as archive:
        for entry in archive:
            path = PurePosixPath(entry.name)
            require(entry.isfile() and not path.is_absolute() and '..' not in path.parts
                    and str(path) == entry.name and entry.name not in result and len(result) < 10000,
                    'Unsafe or duplicate bot archive path: ' + entry.name)
            result[entry.name] = archive.extractfile(entry).read()
    metadata = json.loads(result.pop('metadata.json'))
    require(set(metadata) == {'revision', 'manifest'} and metadata['revision'] == revision, 'Bot revision mismatch')
    manifest = metadata['manifest']
    require(set(result) == {'bot/' + name for name in manifest}, 'Bot archive manifest paths differ')
    bot = {name: result['bot/' + name] for name in manifest}
    require({n: digest(d) for n, d in bot.items()} == manifest, 'Bot archive checksum mismatch')
    require({'REVISION', 'src/index.js', 'src/store.js', 'package.json', 'package-lock.json',
             'scripts/deploy/openrotmg-discord-bot.service', 'node_modules/discord.js/package.json'} <= bot.keys(), 'Incomplete bot package')
    require(bot['REVISION'].decode().strip() == revision, 'Bot source stamp differs')
    require(bot['scripts/deploy/openrotmg-discord-bot.service'] == UNIT.read_bytes(),
            'Service configuration changed; review and install it separately before deploying')
    return bot, manifest


def current_main(revision):
    actual = subprocess.check_output(['git', 'ls-remote', '--exit-code', REPO, 'refs/heads/main'], text=True, timeout=30).split()[0]
    require(actual == revision, 'Main advanced; refusing to deploy stale bot ' + revision)


def snapshot(path):
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        db.execute('BEGIN')
        require(db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'Bot database integrity failed')
        require(not db.execute('PRAGMA foreign_key_check').fetchall(), 'Bot database foreign keys failed')
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
        require(tables == {'levels'}, 'Bot database tables changed; update the backup contract first')
        columns = tuple(r[1] for r in db.execute('PRAGMA table_info(levels)'))
        require(columns == ('guild_id', 'user_id', 'username', 'xp', 'last_xp_at', 'last_message_id'), 'Bot database columns changed; update the backup contract first')
        return db.execute('SELECT * FROM levels ORDER BY guild_id,user_id').fetchall()


def copy_db(source, target):
    with closing(sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True)) as src, closing(sqlite3.connect(target)) as dst:
        src.backup(dst)
    target.chmod(0o600)


def rehearse(stage):
    run('runuser', '-u', SERVICE, '--', 'node', '--test', cwd=stage, timeout=120)
    with tempfile.TemporaryDirectory(prefix='openrotmg-bot-rehearsal-') as directory:
        directory = Path(directory)
        copied = directory / 'levels.sqlite'
        copy_db(DATABASE, copied)
        before = snapshot(copied)
        uid = pwd.getpwnam(SERVICE)
        # Read-only inspection can create WAL sidecars under the deployer's UID.
        for path in [directory, *directory.iterdir()]:
            os.chown(path, uid.pw_uid, uid.pw_gid)
        code = "const {openStore}=await import(process.argv[1]);openStore(process.argv[2]).close();"
        run('runuser', '-u', SERVICE, '--', 'node', '--input-type=module', '-e', code,
            (stage / 'src/store.js').as_uri(), str(copied), timeout=30)
        require(snapshot(copied) == before, 'Candidate changed saved XP/cooldown/replay data during rehearsal')


def exchange(stage):
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.renameat2(-100, os.fsencode(LIVE), -100, os.fsencode(stage), 2):
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


def ready(invocation):
    deadline = time.monotonic() + 100
    while time.monotonic() < deadline:
        require(field(SERVICE, 'ActiveState') == 'active' and field(SERVICE, 'InvocationID') == invocation,
                'Bot exited/restarted during startup; inspect invocation ' + invocation)
        entries = [json.loads(line) for line in subprocess.check_output(
            ['journalctl', '_SYSTEMD_INVOCATION_ID=' + invocation, '--no-pager', '-o', 'cat'], text=True).splitlines() if line.startswith('{')]
        failures = {'startup_failed', 'startup_timeout', 'gateway_error', 'gateway_disconnected', 'hiscores_refresh_failed', 'updates_sync_failed'}
        require(not any(e.get('event') in failures for e in entries), 'Bot readiness failed; inspect invocation ' + invocation)
        started = next((e for e in entries if e.get('event') == 'ready'), None)
        heartbeat = next((e for e in entries if e.get('event') == 'heartbeat'), None)
        synced = next((e for e in entries if e.get('event') == 'updates_synced'), None)
        if started and heartbeat and synced:
            require(started['botId'] == BOT_ID and started['guildId'] == GUILD_ID and heartbeat['gatewayStatus'] == 0, 'Bot identity/gateway mismatch')
            return {'ready': started, 'heartbeat': heartbeat, 'updates_synced': synced}
        time.sleep(1)
    raise TimeoutError('Bot readiness deadline exceeded; inspect invocation ' + invocation)


def deploy(revision, raw):
    bot, manifest = payload(raw, revision)
    current_main(revision)
    require(field(SERVICE, 'ActiveState') == 'active', 'Bot is not active; inspect it before deploying')
    if (LIVE / 'REVISION').read_text().strip() == revision:
        require(files(LIVE) == manifest, 'Already deployed bot differs from this artifact')
        health = ready(field(SERVICE, 'InvocationID'))
        print(json.dumps({'state': 'up_to_date', 'revision': revision, 'pid': field(SERVICE, 'MainPID'), **health}), flush=True)
        return
    require(shutil.disk_usage(LIVE.parent).free >= 2 * 1024**3, 'Less than 2 GiB free; retained recovery data needs review')
    STATE.mkdir(mode=0o700, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix=revision + '-', dir=STATE))
    stage = LIVE.with_name(LIVE.name + '-stage-' + work.name)
    status = {'revision': revision, 'prior_revision': (LIVE / 'REVISION').read_text().strip(), 'recovery': str(work), 'state': 'staging'}
    try:
        stage.mkdir(mode=0o755)
        stage.chmod(0o755)
        for name, data in bot.items():
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        for path in stage.rglob('*'):
            path.chmod(0o755 if path.is_dir() else 0o644)
        rehearse(stage)
        require(files(stage) == manifest, 'Rehearsal changed candidate source files')
        current_main(revision)
        untouched = {u: field(u, 'MainPID') for u in ['openrotmg', 'caddy']}
        unit_hash = digest(UNIT.read_bytes())
        status['state'] = 'stopping'
        run('systemctl', 'stop', SERVICE)
        require(field(SERVICE, 'ActiveState') == 'inactive' and field(SERVICE, 'Result') == 'success', 'Bot did not stop cleanly; no exchange performed')
        before = snapshot(DATABASE)
        copy_db(DATABASE, work / 'before-levels.sqlite')
        exchange(stage)
        status.update(state='activated_unverified', previous_bot=str(stage))
        require(snapshot(DATABASE) == before, 'Bot saved data changed at cutover')
        run('systemctl', 'start', SERVICE)
        invocation = field(SERVICE, 'InvocationID')
        health = ready(invocation)
        after = {(r[0], r[1]): r for r in snapshot(DATABASE)}
        for row in before:
            current = after[(row[0], row[1])]
            require(current[3] >= row[3] and current[4] >= row[4] and int(current[5]) >= int(row[5]), 'Previously saved XP/replay progress regressed')
        require(files(LIVE) == manifest and digest(UNIT.read_bytes()) == unit_hash, 'Running bot source or unit changed')
        require({u: field(u, 'MainPID') for u in untouched} == untouched, 'Game or Caddy process changed during bot deployment')
        status.update(state='deployed', files=len(manifest), saved_rows=len(before), pid=field(SERVICE, 'MainPID'),
                      invocation=invocation, unchanged_pids=untouched, **health)
    except Exception as error:
        status['error'] = str(error)
        raise
    finally:
        status['checked_at'] = int(time.time())
        receipt = json.dumps(status, indent=2)
        (work / 'receipt.json').write_text(receipt)
        temporary = STATE / 'status.json.new'
        temporary.write_text(receipt)
        temporary.replace(STATE / 'status.json')
        print(json.dumps(status), flush=True)


def main():
    os.umask(0o077)
    require(len(sys.argv) == 2 and re.fullmatch('[0-9a-f]{40}', sys.argv[1]), 'Only an exact bot commit SHA is accepted')
    raw = sys.stdin.buffer.read(LIMIT + 1)
    with LOCK.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        deploy(sys.argv[1], raw)


if __name__ == '__main__':
    main()
