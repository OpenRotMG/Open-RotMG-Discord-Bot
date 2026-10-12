import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ACCOUNT_STUBS, COMMANDS, formatUptime } from '../src/commands.js';
import { statusUrl, readGameStatus } from '../src/status.js';
import { handleInteraction, replyInteractionError } from '../src/bot.js';

const guildId = '1558662335076376578';
const online = {online: true, uptimeSeconds: 90061, players: 0, bots: 48};
function command(name, extra = {}) {
  const events = [];
  return {guildId, user: {id: '1'}, commandName: name, events,
    isChatInputCommand: () => true, isRepliable: () => true,
    reply: async value => events.push(['reply', value]),
    deferReply: async value => events.push(['defer', value]),
    editReply: async value => events.push(['edit', value]), ...extra};
}

test('help and registration share the exact complete command list', async () => {
  assert.deepEqual(COMMANDS.map(c => c.name), ['help', 'level', 'uptime', 'players', 'link', 'kick', 'recover']);
  assert.equal(new Set(COMMANDS.map(c => c.name)).size, COMMANDS.length);
  for (const c of COMMANDS) {
    assert.equal(c.type, 1);
    assert.ok(c.description.length > 0 && c.description.length <= 100);
  }
  const help = command('help');
  await handleInteraction(help, {guildId, gameStatus: () => { throw Error('Help fetched game status'); }});
  assert.equal(help.events[0][1].flags, 64);
  for (const c of COMMANDS) assert.ok(help.events[0][1].content.includes(`**/${c.name}**: ${c.description}`));
  await assert.rejects(handleInteraction(command('unknown'), {guildId}), /Unknown command/);
});

test('account stubs are private, explicitly unavailable and never access account, XP or game services', async () => {
  assert.deepEqual(Object.keys(ACCOUNT_STUBS), ['link', 'kick', 'recover']);
  const store = new Proxy({}, {get() {throw Error('Stub accessed the XP database');}});
  const gameStatus = () => {throw Error('Stub contacted the game');};
  for (const [name, content] of Object.entries(ACCOUNT_STUBS)) {
    const registered = COMMANDS.find(c => c.name === name);
    assert.match(registered.description, /not available yet/);
    assert.equal(registered.options, undefined);
    assert.match(content, /isn't implemented yet/);
    assert.match(content, /This command has not/);
    const interaction = command(name);
    await handleInteraction(interaction, {guildId, store, gameStatus});
    assert.deepEqual(interaction.events, [['reply', {content, flags: 64}]]);
    const foreign = command(name, {guildId: 'other'});
    await handleInteraction(foreign, {guildId, store, gameStatus});
    assert.deepEqual(foreign.events, [['reply', {content: 'This bot is configured for the Open RotMG server only.', flags: 64}]]);
  }
  assert.match(ACCOUNT_STUBS.kick, /your own linked account/);
  await assert.rejects(handleInteraction(command('constructor'), {guildId, store, gameStatus}), /Unknown command/);
});

test('uptime formatting covers zero, boundaries and multi-day process uptime', () => {
  for (const [n, text] of [[0, '0d 0h 0m 0s'], [59, '0d 0h 0m 59s'], [60, '0d 0h 1m 0s'], [3600, '0d 1h 0m 0s'], [90061, '1d 1h 1m 1s']]) {
    assert.equal(formatUptime(n), text);
  }
  for (const n of [-1, 0.5, NaN, Infinity]) assert.throws(() => formatUptime(n));
});

test('status commands defer privately before HTTP and separate players from game bots', async () => {
  for (const [name, status, content] of [
    ['uptime', online, 'Game server uptime: **1d 1h 1m 1s**'],
    ['players', online, '0 players, 48 bots'],
    ['players', {...online, players: 1, bots: 1}, '1 player, 1 bot'],
    ['players', {...online, players: 12, bots: 0}, '12 players, 0 bots'],
    ['uptime', {online: false}, 'Game server: down.'],
    ['players', {online: false}, 'Game server: down.'],
  ]) {
    const interaction = command(name);
    await handleInteraction(interaction, {guildId, gameStatus: async () => {
      assert.deepEqual(interaction.events, [['defer', {flags: 64}]]);
      return status;
    }});
    assert.deepEqual(interaction.events, [['defer', {flags: 64}], ['edit', {content}]]);
  }
  const foreign = command('players', {guildId: 'other'});
  await handleInteraction(foreign, {guildId, gameStatus: () => { throw Error('Foreign guild fetched status'); }});
  assert.equal(foreign.events[0][1].flags, 64);
});

test('deferred errors finish the private response instead of leaving it thinking', async () => {
  const interaction = command('players', {deferred: true});
  await assert.rejects(handleInteraction(interaction, {guildId, gameStatus: async () => { throw Error('Missing bots field'); }}), /Missing bots/);
  await replyInteractionError(interaction);
  assert.equal(interaction.events.at(-1)[0], 'edit');
  assert.match(interaction.events.at(-1)[1].content, /error has been logged/);
  const fresh = command('help');
  await replyInteractionError(fresh);
  assert.equal(fresh.events[0][1].flags, 64);
  const alreadyReplied = command('help', {replied: true});
  await replyInteractionError(alreadyReplied);
  assert.deepEqual(alreadyReplied.events, []);
});

test('game endpoint configuration is explicit and cannot contain credentials', () => {
  assert.equal(statusUrl('https://openrotmg.org/health'), 'https://openrotmg.org/health');
  assert.equal(statusUrl('http://127.0.0.1:18923/health'), 'http://127.0.0.1:18923/health');
  for (const value of [undefined, '', 'garbage', 'file:///tmp/status', 'https://user:password@example.com/health', 'https://example.com/health?token=secret', 'https://example.com/health#fragment']) {
    assert.throws(() => statusUrl(value));
  }
});

test('malformed or misconfigured status is an explicit error, never fabricated zero counts or down', async () => {
  const valid = {uptime_seconds: 60, players: 0, bots: 48};
  for (const key of Object.keys(valid)) {
    for (const value of [undefined, null, true, '0', -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(readGameStatus('https://example.com/health', async () => new Response(JSON.stringify({...valid, [key]: value}))), new RegExp(`invalid ${key}`));
    }
  }
  await assert.rejects(readGameStatus('https://example.com/health', async () => new Response('not JSON')), SyntaxError);
  for (const status of [301, 400, 401, 403, 404, 429]) {
    await assert.rejects(readGameStatus('https://example.com/health', async () => new Response('', {status})), new RegExp(`HTTP ${status}`));
  }
  await assert.rejects(readGameStatus('https://example.com/health', async () => { throw new TypeError('programming bug'); }), /programming bug/);
  const failure = new TypeError('fetch failed', {cause: {code: 'ECONNREFUSED'}});
  assert.equal((await readGameStatus('https://example.com/health', async () => { throw failure; })).online, false);
});

test('real HTTP GET: live counts, unavailable response, redirect rejection and full-body timeout', async () => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({method: req.method, path: req.url});
    if (req.url === '/health') {res.setHeader('content-type', 'application/json');res.end(JSON.stringify({uptime_seconds: 123, players: 2, bots: 48}));}
    else if (req.url === '/down') {res.writeHead(503);res.end('unavailable');}
    else if (req.url === '/redirect') {res.writeHead(302, {location: '/health'});res.end();}
    else if (req.url === '/hung') {res.writeHead(200, {'content-type': 'application/json'});res.flushHeaders();}
    else {res.writeHead(404);res.end();}
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await readGameStatus(`${base}/health`), {online: true, uptimeSeconds: 123, players: 2, bots: 48});
    assert.deepEqual(await readGameStatus(`${base}/down`), {online: false, reason: {status: 503}});
    await assert.rejects(readGameStatus(`${base}/redirect`), /fetch failed/);
    const started = performance.now();
    const timedOut = await readGameStatus(`${base}/hung`);
    assert.equal(timedOut.online, false);
    assert.equal(timedOut.reason.name, 'TimeoutError');
    assert.ok(performance.now() - started < 3000);
    assert.ok(requests.every(r => r.method === 'GET'));
    assert.equal(requests.filter(r => r.path === '/health').length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  assert.equal((await readGameStatus(`${base}/health`)).online, false);
});
