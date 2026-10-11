import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';
import { xpForLevel, levelForXp } from '../src/xp.js';
import { buildLevel, jumpModal } from '../src/levels.js';
import { handleMessage, handleInteraction } from '../src/bot.js';

const guildId = '1558662335076376578';
function message(id, user = '1', extra = {}) {
  return {id: String(id), guildId, author: {id: user, username: `Tester${user}`, bot: false}, webhookId: null, ...extra};
}
function field(card, name) { return card.embeds[0].fields.find(field => field.name === name).value; }
function interaction(extra) {
  return {guildId, user: {id: '1'}, isChatInputCommand: () => false, isButton: () => false, isModalSubmit: () => false, ...extra};
}

test('exact OSRS thresholds and every boundary through level 99', () => {
  assert.equal(xpForLevel(2), 83);
  assert.equal(xpForLevel(3), 174);
  assert.equal(xpForLevel(50), 101333);
  assert.equal(xpForLevel(99), 13034431);
  for (let level = 2; level <= 99; level++) {
    assert.equal(levelForXp(xpForLevel(level) - 1), level - 1);
    assert.equal(levelForXp(xpForLevel(level)), level);
  }
  assert.equal(levelForXp(20000000), 99);
  for (const value of [-1, NaN, Infinity, 0.5]) assert.throws(() => levelForXp(value));
  for (const value of [0, 100, 1.5, NaN]) assert.throws(() => xpForLevel(value));
});

test('10 XP, exact five-second boundary, duplicate/out-of-order suppression, durable cooldown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openrotmg-bot-'));
  const path = join(dir, 'levels.sqlite');
  let store = openStore(path);
  try {
    assert.equal(store.award(message(1), 0).xp, 10);
    assert.equal(store.award(message(2), 4999), null);
    store.close(); store = openStore(path);
    assert.equal(store.award(message(3), 4999), null);
    assert.equal(store.award(message(3), 5000).xp, 20);
    assert.equal(store.award(message(3), 10000), null);
    assert.equal(store.award(message(2), 10000), null);
    assert.equal(store.award(message(4), 10000).xp, 30);
    assert.equal(store.me(guildId, '1').xp, 30);
    assert.throws(() => store.award(message(5), -1));
    assert.equal(store.award(message(5), 15000).xp, 40);
  } finally { store.close(); rmSync(dir, {recursive: true}); }
});

test('normal messages level exactly once, with the same message and only the author mention', async () => {
  const store = openStore(':memory:');
  const sent = [];
  let clock = 0;
  const context = {store, guildId, now: () => clock};
  const channel = {send: async payload => sent.push(payload)};
  try {
    for (let i = 1; i <= 18; i++) {
      await handleMessage(message(i, '1', {channel}), context);
      clock += 5000;
    }
    assert.equal(store.me(guildId, '1').xp, 180);
    assert.deepEqual(sent.map(s => s.content), [
      "Congratulations <@1>! You're now Level 2! 🎉",
      "Congratulations <@1>! You're now Level 3! 🎉",
    ]);
    assert.deepEqual(sent[0].allowedMentions, {parse: [], users: ['1']});
  } finally { store.close(); }
});

test('bots, webhooks, DMs, foreign guilds ignored; content never accessed', async () => {
  const store = openStore(':memory:');
  try {
    for (const extra of [{author: {id: '1', bot: true}}, {webhookId: '9'}, {guildId: null}, {guildId: 'other'}]) {
      await handleMessage(message(1, '1', extra), {store, guildId});
    }
    assert.equal(store.me(guildId, '1'), undefined);
    const msg = message(2);
    Object.defineProperty(msg, 'content', {get() { throw new Error('Message content accessed'); }});
    await handleMessage(msg, {store, guildId, now: () => 0});
    assert.equal(store.me(guildId, '1').xp, 10);
  } finally { store.close(); }
});

test('unknown user gets explicit no-XP card, no fabricated rank', () => {
  const store = openStore(':memory:');
  try {
    const card = buildLevel(store, guildId, '1');
    assert.equal(card.embeds[0].title, 'No XP yet');
    assert.equal(card.embeds[0].fields, undefined);
    assert.equal(card.components, undefined);
  } finally { store.close(); }
});

test('25 users: three pages, ties, exact invoker page, paging bounds, name escaping and guild isolation', () => {
  const store = openStore(':memory:');
  try {
    for (let i = 1; i <= 25; i++) {
      const user = String(i).padStart(2, '0');
      const count = i === 22 ? 30 - 21 : 30 - i;
      for (let n = 1; n <= count; n++) store.award(message(n, user), n * 5000);
    }
    const initial = buildLevel(store, guildId, '15');
    assert.equal(initial.embeds[0].footer.text, 'Page 2 of 3');
    assert.match(initial.embeds[0].description, /#15/);
    assert.equal(field(initial, 'Total XP'), '150');
    assert.equal(field(initial, 'XP to next level'), '24');
    assert.match(field(initial, 'Leaderboard'), /▶ \*\*`#15` Tester15/);
    const pages = [0, 1, 2].map(page => buildLevel(store, guildId, '01', page));
    assert.deepEqual(pages.map(card => field(card, 'Leaderboard').split('\n').length), [10, 10, 5]);
    const last = field(pages[2], 'Leaderboard').split('\n');
    assert.match(last[0], /#21/); assert.match(last[1], /#21/); assert.match(last[2], /#23/);
    assert.equal(pages[0].components[0].components[0].disabled, true);
    assert.equal(pages[2].components[0].components[1].disabled, true);
    assert.equal(buildLevel(store, guildId, '01', 99).embeds[0].footer.text, 'Page 3 of 3');
    assert.equal(buildLevel(store, 'other', '01').embeds[0].title, 'No XP yet');
    for (let i = 1; i <= 10; i++) {
      store.award(message(100, String(i).padStart(2, '0'), {author: {id: String(i).padStart(2, '0'), username: '`'.repeat(32), bot: false}}), 1000000);
    }
    const escaped = field(buildLevel(store, guildId, '01', 0), 'Leaderboard');
    assert.match(escaped, /\\`/);
    assert.ok(escaped.length <= 1024);
    assert.throws(() => buildLevel(store, guildId, '01', -1));
  } finally { store.close(); }
});

test('slash, buttons, modal jump, invalid input, and foreign guild responses are private', async () => {
  const store = openStore(':memory:');
  const replies = [];
  const updates = [];
  const modals = [];
  const common = {reply: async value => replies.push(value), update: async value => updates.push(value), showModal: async value => modals.push(value)};
  try {
    store.award(message(1), 0);
    await handleInteraction(interaction({...common, isChatInputCommand: () => true, commandName: 'level'}), {store, guildId});
    assert.equal(replies[0].flags, 64);
    await handleInteraction(interaction({...common, isButton: () => true, customId: 'lvl:0'}), {store, guildId});
    assert.equal(updates.length, 1);
    await handleInteraction(interaction({...common, isButton: () => true, customId: 'lvl:jump:2'}), {store, guildId});
    assert.deepEqual(modals[0], jumpModal(2));
    const modal = text => interaction({...common, isModalSubmit: () => true, customId: 'lvl:go', fields: {getTextInputValue: () => text}, isFromMessage: () => true});
    await handleInteraction(modal('2'), {store, guildId});
    assert.equal(updates.length, 2);
    await handleInteraction(modal('0'), {store, guildId});
    assert.equal(replies[1].flags, 64);
    await handleInteraction(interaction({...common, guildId: 'other'}), {store, guildId});
    assert.equal(replies[2].flags, 64);
  } finally { store.close(); }
});

test('notification failure is explicit, award persisted, replay does not ping again', async () => {
  const store = openStore(':memory:');
  try {
    for (let n = 1; n <= 8; n++) store.award(message(n), n * 5000);
    const msg = message(9, '1', {channel: {send: async () => { throw new Error('Missing Send Messages permission'); }}});
    await assert.rejects(handleMessage(msg, {store, guildId, now: () => 45000}), /Missing Send/);
    assert.equal(store.me(guildId, '1').xp, 90);
    await handleMessage(msg, {store, guildId, now: () => 50000});
  } finally { store.close(); }
});
