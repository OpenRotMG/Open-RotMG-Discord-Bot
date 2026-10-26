import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { COMMANDS } from '../src/commands.js';
import { handleInteraction } from '../src/bot.js';

const guildId = '1558662335076376578';
const target = '1558662335076376579';
const actor = '1558662335076376580';
const request = '1558662335076376581';
function command(extra = {}) {
  return {guildId, user: {id: actor}, id: request, commandName: 'gold',
    isChatInputCommand: () => true,
    memberPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
    options: {getUser: () => ({id: target}), getInteger: () => 100},
    ...extra};
}

test('/gold registration requires Administrator and bounded required user/amount options', () => {
  const gold = COMMANDS.find(c => c.name === 'gold');
  assert.equal(gold.default_member_permissions, String(PermissionFlagsBits.Administrator));
  assert.deepEqual(gold.options.map(o => [o.name, o.type, o.required]), [['user', 6, true], ['amount', 4, true]]);
  assert.equal(gold.options[1].min_value, 1);
  assert.equal(gold.options[1].max_value, 2147483647);
});

test('/gold denies non-admins, DMs and foreign guilds before reading options or contacting game', async () => {
  const replies = [];
  const forbidden = {options: {getUser() {throw new Error('Read denied options');}}, reply: async p => replies.push(p)};
  for (const memberPermissions of [undefined, null, new PermissionsBitField(), new PermissionsBitField(PermissionFlagsBits.ManageGuild)]) {
    await handleInteraction(command({...forbidden, memberPermissions}), {guildId, goldGame: () => assert.fail('Unauthorized API call')});
    assert.match(replies.at(-1).content, /Administrator/);
    assert.equal(replies.at(-1).flags, 64);
  }
  for (const guild of [null, 'other']) {
    await handleInteraction(command({...forbidden, guildId: guild}), {guildId, goldGame: () => assert.fail('Foreign guild API call')});
    assert.equal(replies.at(-1).flags, 64);
  }
});

test('/gold credits the selected user, sends actor and interaction ID, and replies privately without pings', async () => {
  const calls = [], replies = [];
  const goldGame = async (...args) => {calls.push(args); return {balance: 150};};
  await handleInteraction(command({
    deferReply: async p => {assert.deepEqual(p, {flags: 64});},
    editReply: async p => replies.push(p),
  }), {guildId, goldGame});
  assert.deepEqual(calls, [[target, 100, request, actor]]);
  assert.match(replies[0].content, /Added 100 gold/);
  assert.match(replies[0].content, new RegExp(target));
  assert.match(replies[0].content, /Balance: 150 gold/);
  assert.deepEqual(replies[0].allowedMentions, {parse: []});
});

test('/gold rejects invalid amounts and never fabricates success for unlinked users, outages or malformed receipts', async () => {
  const replies = [];
  const reply = async p => replies.push(p);
  for (const amount of [0, -1, 1.5, NaN, 2147483648]) {
    await handleInteraction(command({reply, options: {getUser: () => ({id: target}), getInteger: () => amount}}),
      {guildId, goldGame: () => assert.fail('Invalid amount API call')});
    assert.equal(replies.at(-1).flags, 64);
    assert.match(replies.at(-1).content, /whole number/);
  }
  for (const goldGame of [
    async () => {throw new Error('no authenticated game account linked to this Discord identity');},
    async () => {throw new Error('Request timed out');},
    ...[{}, {balance: -1}, {balance: 1.5}, {balance: 99}, {balance: 2147483648}].map(result => async () => result),
  ]) {
    await handleInteraction(command({deferReply: reply, editReply: reply}), {guildId, goldGame});
    assert.match(replies.at(-1).content, /could not be confirmed/);
    assert.match(replies.at(-1).content, /before issuing another/);
    assert.deepEqual(replies.at(-1).allowedMentions, {parse: []});
  }
  await assert.rejects(handleInteraction(command(), {guildId}), /Gold API is not configured/);
});
