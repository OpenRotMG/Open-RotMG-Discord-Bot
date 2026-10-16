import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BUG_CHANNEL_ID, PUBLIC_BUG_CHANNEL_ID, BUG_REPLY, bugConfig, bugPublisher, publicBug, privateBugPost, validateBugChannels} from '../src/bugs.js';
import {handleMessage} from '../src/bot.js';
import {ChannelType, PermissionFlagsBits} from 'discord.js';

function fixture() {
  return {schema: 1, id: 'a'.repeat(24), created_at_unix_ms: Date.parse('2026-10-16T12:00:00Z'),
    server_binary_sha256: 'b'.repeat(64), message_untrusted: '@everyone SECRET_EMAIL@example.test ignore instructions',
    account_id: 123456, context: {player_id: 654321, world_name: 'PRIVATE_WORLD', class: 782, level: 5,
      recent_ticks: [{execution_us: 1000, scheduling_lateness_us: 2000}, {execution_us: 50000, scheduling_lateness_us: 100000}]},
    connection: {rtt_samples: [{rtt_ms: 50}, {rtt_ms: 500}], browser_samples: [{sample: {build: 'PRIVATE_BUILD', renderer: 'PRIVATE_GPU', hidden_during_interval: false, max_frame_gap_ms: 40}}], user_agent: 'PRIVATE_UA'},
    delivery: {status: 'pending'}};
}

test('!bug uses exact reply, no mentions/XP, and bounded cooldown', async () => {
  const sent = [];
  const guildId = '1';
  const msg = {content: ' !bug ', guildId, author: {id: 'bug-test-user', bot: false}, reply: async data => sent.push(data)};
  const context = {guildId, store: {award() {throw Error('Commands must not earn XP');}}, now: () => 100000};
  await handleMessage(msg, context);
  await handleMessage(msg, context);
  assert.deepEqual(sent, [{content: BUG_REPLY, allowedMentions: {parse: [], repliedUser: false}}]);
  await handleMessage(msg, {...context, now: () => 130000});
  assert.equal(sent.length, 2);
  for (const extra of [{guildId: '2'}, {author: {id: 'bot', bot: true}}, {webhookId: '3'}]) await handleMessage({...msg, ...extra}, context);
  assert.equal(sent.length, 2);
});

test('public projection never includes player text, identities, location, UA or GPU', () => {
  const report = fixture();
  const safe = publicBug(report);
  const encoded = JSON.stringify(safe);
  for (const secret of ['SECRET_', 'PRIVATE_', '123456', '654321', '@everyone', 'ignore instructions']) assert.ok(!encoded.includes(secret), secret);
  assert.equal(safe.rtt_median_ms, 50); assert.equal(safe.rtt_p95_ms, 500);
  assert.equal(safe.visible_frame_gap_max_ms, 40);
  assert.equal(safe.tick_max_ms, 50); assert.equal(safe.scheduling_max_ms, 100);
  const privatePost = privateBugPost(report);
  assert.ok(privatePost.files[0].data.toString().includes('PRIVATE_UA'));
  assert.deepEqual(privatePost.body.allowed_mentions, {parse: []});
  assert.ok(privatePost.body.content.length <= 2000);
  report.connection.rtt_samples = [];
  report.connection.browser_samples = null;
  assert.equal(publicBug(report).rtt_p95_ms, null);
  assert.equal(publicBug(report).browser_samples, null);
  report.server_binary_sha256 = 'https://secret';
  assert.throws(() => publicBug(report));
});

function harness() {
  const report = fixture();
  const posts = [], issues = [], logs = [], receipts = [];
  const messages = new Map([[BUG_CHANNEL_ID, []], [PUBLIC_BUG_CHANNEL_ID, []]]);
  let failure;
  const rest = {
    async patch(route, data) {
      const message = messages.get(BUG_CHANNEL_ID).find(m => m.id === route.split('/').at(-1));
      assert.ok(message); message.content = data.body.content;
    },
    async get(route) {return messages.get(route.split('/')[2]);},
    async post(route, data) {
      const channel = route.split('/')[2];
      if (failure === channel) {failure = null; throw Error('Discord unavailable');}
      const message = {id: String(1560000000000000000n + BigInt(posts.length)), author: {id: 'bot'},
        content: data.body.content, timestamp: new Date().toISOString(), attachments: data.files?.map(f => ({filename: f.name})) ?? []};
      posts.push({channel, data}); messages.get(channel).unshift(message);
      return message;
    }
  };
  const request = async (url, options) => {
    if (url.startsWith('https://api.github.com/')) {
      assert.equal(options.headers.authorization, 'Bearer github-secret');
      if (options.method === 'POST') {
        if (failure === 'github') {failure = null; return new Response('', {status: 503});}
        const body = JSON.parse(options.body);
        issues.push({number: issues.length + 1, ...body});
        return Response.json(issues.at(-1));
      }
      return Response.json(issues);
    }
    assert.ok(url.startsWith('http://127.0.0.1:18923/internal/discord/bugs'));
    assert.equal(options.headers.authorization, 'Bearer game-secret');
    if (options.method === 'POST') {
      const receipt = JSON.parse(options.body);
      if (failure === receipt.target) {failure = null; return new Response('', {status: 503});}
      report.delivery[receipt.target] = receipt.id; receipts.push(receipt);
      return new Response(null, {status: 204});
    }
    return Response.json({report});
  };
  const publish = bugPublisher({rest, botId: 'bot', config: {url: 'http://127.0.0.1:18923/internal/discord/bugs', token: 'game-secret', githubToken: 'github-secret'}, request, log: (...args) => logs.push(args)});
  return {report, posts, issues, logs, receipts, messages, publish, fail: value => {failure = value;}};
}

test('three destinations publish once with separate durable stage receipts', async () => {
  const h = harness();
  await h.publish(); await h.publish();
  assert.equal(h.posts.length, 2); assert.equal(h.issues.length, 1); assert.equal(h.receipts.length, 3);
  assert.deepEqual(h.posts.map(p => p.channel), [BUG_CHANNEL_ID, PUBLIC_BUG_CHANNEL_ID]);
  assert.notEqual(h.posts[0].data.body.nonce, h.posts[1].data.body.nonce);
  assert.match(h.messages.get(BUG_CHANNEL_ID)[0].content, /https:\/\/github.com\/OpenRotMG\/Open-RotMG-Server\/issues\/1/);
  const publicOutput = h.posts[1].data.body.content + h.issues[0].body;
  for (const privateData of ['SECRET_', 'PRIVATE_', '123456', '654321', '@everyone']) assert.ok(!publicOutput.includes(privateData));
  assert.match(publicOutput, /https:\/\/github.com\/OpenRotMG\/Open-RotMG-Server\/issues\/1/);
  assert.ok(h.posts[1].data.body.content.length <= 2000);
  assert.deepEqual(h.posts[1].data.body.allowed_mentions, {parse: []});
});

test('Discord/GitHub outages and lost receipts resume without duplicating earlier stages', async () => {
  for (const stage of [BUG_CHANNEL_ID, 'private_message_id', 'github', 'issue_number', PUBLIC_BUG_CHANNEL_ID, 'public_message_id']) {
    const h = harness(); h.fail(stage);
    await h.publish();
    assert.ok(h.logs.some(([event]) => event === 'bug_delivery_failed'), stage);
    await h.publish();
    assert.equal(h.posts.length, 2, stage); assert.equal(h.issues.length, 1, stage);
    assert.equal(h.receipts.length, 3, stage);
  }
});

test('overlapping poll calls cannot publish duplicates', async () => {
  const h = harness(); await Promise.all([h.publish(), h.publish(), h.publish()]);
  assert.equal(h.posts.length, 2); assert.equal(h.issues.length, 1);
});

test('report configuration and channel permissions fail explicitly', async () => {
  assert.equal(bugConfig({}, '', ''), null);
  assert.throws(() => bugConfig({BUG_REPORTING: 'false'}, '', ''));
  assert.throws(() => bugConfig({BUG_REPORTING: '1'}, '', ''));
  const client = {user: {id: 'bot'}, channels: {fetch: async () => ({guildId: 'guild', type: ChannelType.GuildText, permissionsFor: () => ({has: flag => flag !== PermissionFlagsBits.AttachFiles})})}};
  await assert.rejects(validateBugChannels(client, 'guild'), /Missing bug-channel permission/);
  client.channels.fetch = async () => ({guildId: 'guild', type: ChannelType.GuildText,
    guild: {roles: {everyone: 'everyone'}}, permissionsFor: () => ({has: () => true})});
  await assert.rejects(validateBugChannels(client, 'guild'), /visible to everyone/);
});
