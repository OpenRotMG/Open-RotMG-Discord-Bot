import {test} from 'node:test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {cancelRestart} from '../src/restart.js';
import assert from 'node:assert/strict';
import {PermissionsBitField, PermissionFlagsBits} from 'discord.js';
import {COMMANDS} from '../src/commands.js';
import {handleInteraction} from '../src/bot.js';

const guildId = '1558662335076376578', actor = '1558662335076376580', announceRoleId = '1558662335076376581';
function command(extra = {}) {
  return {guildId, user: {id: actor}, commandName: 'cancel-restart', isChatInputCommand: () => true,
    member: {roles: {cache: new Set([announceRoleId])}}, ...extra};
}

test('/cancel-restart is registered without changing existing role permissions', () => {
  const registration = COMMANDS.find(c => c.name === 'cancel-restart');
  assert.ok(registration);
  assert.equal(registration.type, 1);
  assert.equal(registration.default_member_permissions, undefined);
});

test('/cancel-restart invokes the production handler privately for moderators and administrators', async () => {
  for (const extra of [{}, {member: null, memberPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator)}]) {
    const calls = [], replies = [];
    await handleInteraction(command({...extra, deferReply: async p => assert.deepEqual(p, {flags: 64}), editReply: async p => replies.push(p)}),
      {guildId, announceRoleId, announceGame: async () => ({players: 2}), cancelRestartGame: async id => {calls.push(id); return {state: 'cancelled'};}});
    assert.deepEqual(calls, [actor]);
    assert.match(replies[0].content, /restart cancelled/i);
    assert.deepEqual(replies[0].allowedMentions, {parse: []});
  }
});

test('/cancel-restart denies unauthorized members, DMs and foreign guilds before contacting the game', async () => {
  for (const extra of [{member: null}, {member: {roles: {cache: new Set()}}}, {guildId: null}, {guildId: 'other'}]) {
    const replies = [];
    await handleInteraction(command({...extra, reply: async p => replies.push(p)}),
      {guildId, announceRoleId, announceGame: async () => ({players: 2}), cancelRestartGame: () => assert.fail('Unauthorized cancellation')});
    assert.equal(replies[0].flags, 64);
  }
});

test('/cancel-restart never reports success for missing, expired, consumed or unconfirmed cancellations', async () => {
  for (const result of [new Error('No pending restart'), new Error('Restart deadline passed'), new Error('Restart already consumed'), new Error('Request timed out'), {}, {state: 'consumed'}]) {
    const replies = [];
    await handleInteraction(command({deferReply: async () => {}, editReply: async p => replies.push(p)}),
      {guildId, announceRoleId, announceGame: async () => ({players: 2}), cancelRestartGame: async () => {if (result instanceof Error) throw result; return result;}});
    assert.match(replies[0].content, /could not be confirmed/i);
    assert.deepEqual(replies[0].allowedMentions, {parse: []});
  }
  await assert.rejects(handleInteraction(command(), {guildId, announceRoleId}), /Restart API is not configured/);
});

test('/cancel-restart does not repeat cancellation if its Discord reply fails', async () => {
  let replies = 0, cancellations = 0;
  await assert.rejects(handleInteraction(command({deferReply: async () => {}, editReply: async () => {replies++; throw new Error('Discord reply unavailable');}}),
    {guildId, announceRoleId, cancelRestartGame: async () => {cancellations++; return {state: 'cancelled'};}}), /Discord reply unavailable/);
  assert.deepEqual([replies, cancellations], [1, 1]);
});

test('production command and transport bind the exact server receipt with mock authentication', async t => {
  const receipt = {instance: 'a'.repeat(64), owner: 'b'.repeat(64), deadline_ms: 90000};
  const calls = [];
  let mode = 'ok';
  const server = createServer(async (req, res) => {
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    const body = JSON.parse(Buffer.concat(buffers));
    calls.push(body);
    assert.equal(req.url, '/internal/lifecycle/restart');
    assert.equal(req.headers.authorization, 'Bearer test-only');
    if (mode === 'race' && body.operation === 'cancel') {
      res.writeHead(409).end(JSON.stringify({error: 'restart already consumed'}));
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({state: body.operation === 'status' ? 'pending' : 'cancelled',
      receipt: mode === 'foreign' && body.operation === 'cancel' ? {...receipt, owner: 'c'.repeat(64)} : receipt}));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const replies = [];
  const interaction = command({deferReply: async () => {}, editReply: async p => replies.push(p)});
  const context = {guildId, announceRoleId, cancelRestartGame: id => cancelRestart(origin, 'test-only', id), announceGame: async () => ({players: 2})};
  await handleInteraction(interaction, context);
  assert.deepEqual(calls, [{operation: 'status'}, {operation: 'cancel', receipt, actor_id: actor}]);
  assert.match(replies.at(-1).content, /restart cancelled/);
  mode = 'race';
  await handleInteraction(interaction, context);
  assert.match(replies.at(-1).content, /could not be confirmed: restart already consumed/);
  mode = 'foreign';
  await handleInteraction(interaction, context);
  assert.match(replies.at(-1).content, /could not be confirmed: Invalid restart cancellation response/);
});
