import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Routes} from 'discord.js';
import {reactionConfig, postReactor, backfillReactions} from '../src/reactions.js';

const env = {DISCORD_GUILD_ID: '1558662335076376578', ANNOUNCEMENTS_CHANNEL_ID: '1558662517037990029', UPDATE_BLOG_CHANNEL_ID: '1559046091805171732', AMULET_EMOJI_ID: '1558672358464688178'};
const config = reactionConfig(env);
const id = n => String(1550000000000001000n - BigInt(n));
function fixture() {
  const puts = [], logs = [], pages = new Map();
  const rest = {
    get: async (route, options) => {
      if (route === Routes.guildEmojis(config.guildId)) return [{id: config.emojiId, name: 'amulet_of_reserrection', available: true}];
      const i = config.channelIds.findIndex(c => route === Routes.channel(c));
      if (i !== -1) return {id: config.channelIds[i], name: ['announcements', 'update-blog'][i], guild_id: config.guildId, type: 0};
      assert.equal(options.query.get('limit'), '100');
      const key = route + ':' + options.query.get('before');
      assert.ok(pages.has(key), `Unexpected history page ${key}`);
      return pages.get(key);
    },
    put: async route => puts.push(route),
  };
  return {rest, puts, logs, pages, log: (event, fields) => logs.push({event, ...fields})};
}
function page(f, channel, before, messages) {
  f.pages.set(Routes.channelMessages(channel) + ':' + before, messages.map(m => ({channel_id: channel, ...m})));
}

test('reaction configuration rejects missing/malformed/identical channel IDs', () => {
  assert.deepEqual(reactionConfig(env), config);
  for (const key of Object.keys(env)) {
    assert.throws(() => reactionConfig({...env, [key]: undefined}), /must be Discord IDs/);
    assert.throws(() => reactionConfig({...env, [key]: 'wrong'}), /must be Discord IDs/);
  }
  assert.throws(() => reactionConfig({...env, UPDATE_BLOG_CHANNEL_ID: env.ANNOUNCEMENTS_CHANNEL_ID}), /distinct/);
});

test('new human, bot and webhook posts react in both targets; foreign guilds/channels/threads do not', async () => {
  const f = fixture();
  const react = await postReactor(f.rest, config, f.log);
  for (const channelId of config.channelIds) {
    for (const extra of [{author: {bot: false}}, {author: {bot: true}}, {webhookId: id(1)}]) {
      const message = {id: id(0), channelId, guildId: config.guildId, ...extra};
      Object.defineProperty(message, 'content', {get() { throw Error('Content accessed'); }});
      assert.equal(await react(message), true);
    }
  }
  for (const extra of [{guildId: null}, {guildId: id(10)}, {channelId: id(11)}]) {
    assert.equal(await react({id: id(0), channelId: config.channelIds[0], guildId: config.guildId, ...extra}), false);
  }
  assert.equal(f.puts.length, 6);
  assert.ok(f.puts.every(p => p.endsWith(`/amulet_of_reserrection%3A${config.emojiId}/@me`)));
  assert.equal(f.logs.length, 6);
});

test('wrong server/name/type and unavailable/missing emoji fail before any reaction', async () => {
  for (const override of [{guild_id: id(1)}, {name: 'general'}, {type: 15}]) {
    const f = fixture(), get = f.rest.get;
    f.rest.get = async (...args) => ({...await get(...args), ...override});
    await assert.rejects(postReactor(f.rest, config, f.log), /expected server post channel/);
    assert.equal(f.puts.length, 0);
  }
  for (const emojis of [[], [{id: config.emojiId, available: false}]]) {
    const f = fixture(), get = f.rest.get;
    f.rest.get = async (...args) => args[0] === Routes.guildEmojis(config.guildId) ? emojis : get(...args);
    await assert.rejects(postReactor(f.rest, config, f.log), /not available/);
  }
});

test('history crosses 100-message boundary, skips only our existing reaction, never touches content or XP', async () => {
  const f = fixture(), [a, b] = config.channelIds;
  const messages = Array.from({length: 100}, (_, n) => ({id: id(n)}));
  messages[0].reactions = [{emoji: {id: config.emojiId}, me: true}];
  messages[1].reactions = [{emoji: {id: config.emojiId}, me: false}];
  messages[2].reactions = [{emoji: {id: id(10)}, me: true}];
  Object.defineProperty(messages[3], 'content', {get() { throw Error('Content read'); }});
  page(f, a, null, messages); page(f, a, id(99), [{id: id(100)}]); page(f, a, id(100), []);
  page(f, b, null, [{id: id(1)}]); page(f, b, id(1), []);
  const react = await postReactor(f.rest, config, f.log);
  assert.deepEqual(await backfillReactions(f.rest, config, react, f.log), [
    {channelId: a, scanned: 101, added: 100, alreadyReacted: 1},
    {channelId: b, scanned: 1, added: 1, alreadyReacted: 0},
  ]);
  assert.equal(f.puts.length, 101);
});

test('backfill reruns without adding anything once our reactions exist', async () => {
  const f = fixture();
  for (const c of config.channelIds) {
    page(f, c, null, [{id: id(0), reactions: [{emoji: {id: config.emojiId}, me: true}]}]); page(f, c, id(0), []);
  }
  const react = await postReactor(f.rest, config, f.log);
  const result = await backfillReactions(f.rest, config, react, f.log);
  assert.ok(result.every(c => c.added === 0 && c.alreadyReacted === 1));
  assert.equal(f.puts.length, 0);
});

test('malformed/repeating history pages and reaction API failures stop explicitly', async () => {
  for (const messages of [[{id: 'bad'}], [{id: id(0), channel_id: id(10)}], [{id: id(0)}, {id: id(0)}]]) {
    const f = fixture(); page(f, config.channelIds[0], null, messages);
    await assert.rejects(backfillReactions(f.rest, config, async () => true, f.log), /Invalid history cursor/);
  }
  const f = fixture(); page(f, config.channelIds[0], null, [{id: id(0)}]);
  f.rest.put = async () => {throw Error('Missing Add Reactions');};
  const react = await postReactor(f.rest, config, f.log);
  await assert.rejects(backfillReactions(f.rest, config, react, f.log), /Missing Add Reactions/);
  assert.equal(f.logs.length, 0);
});
