import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PUBLIC_BUG_CHANNEL_ID, BUG_REPLY, bugConfig, bugPublisher, bugTitle, bugIssue, validateBugChannels} from '../src/bugs.js';
import {handleMessage} from '../src/bot.js';
import {ChannelType, MessageFlags, PermissionFlagsBits} from 'discord.js';
const origin = 'https://openrotmg.org';
function fixture() {
  return {schema: 3, reporter_name: 'BugWizard', id: 'a'.repeat(24), created_at_unix_ms: Date.parse('2026-10-16T12:00:00Z'),
    message_untrusted: 'Enemies freeze, then catch up\nI can still move.', account_id: 123456,
    context: {player_id: 654321, world_name: 'PRIVATE_WORLD'},
    connection: {user_agent: 'PRIVATE_UA'}, diagnostics: {environment: {browser: 'Chrome', os: 'Linux'}},
    diagnostics_url: `${origin}/api/bug-reports/${'a'.repeat(24)}/diagnostics.json`, delivery: {status: 'pending'}};
}
test('!bug keeps exact guidance, no mentions/XP, and bounded cooldown', async () => {
  const sent = [], guildId = '1';
  const msg = {content: ' !bug ', guildId, author: {id: 'bug-test-user', bot: false}, reply: async data => sent.push(data)};
  const context = {guildId, store: {award() {throw Error('Commands must not earn XP');}}, now: () => 100000};
  await handleMessage(msg, context); await handleMessage(msg, context);
  assert.deepEqual(sent, [{content: BUG_REPLY, allowedMentions: {parse: [], repliedUser: false}}]);
  await handleMessage(msg, {...context, now: () => 130000}); assert.equal(sent.length, 2);
});
test('title uses first line, normalized whitespace and 100 Unicode characters without inventing a summary', () => {
  assert.equal(bugTitle('  Enemies   freeze\nthen catch up'), 'Enemies freeze');
  assert.equal(bugTitle('a'.repeat(101)), 'a'.repeat(97) + '...');
  assert.equal(Array.from(bugTitle('🐉'.repeat(101))).length, 100);
  assert.throws(() => bugTitle('  \n '));
});
test('issue identifies the reporter without private account or telemetry data', () => {
  const report = fixture(), issue = bugIssue(report, origin);
  assert.equal(issue.title, 'Enemies freeze, then catch up');
  assert.match(issue.body, /> Enemies freeze, then catch up\n> I can still move\./);
  assert.match(issue.body, /\*\*Reporter:\*\* BugWizard/);
  for (const reporter_name of [undefined, '', ' ', 'a'.repeat(65), 'Bad\nName']) {
    assert.throws(() => bugIssue({...report, reporter_name}, origin), /Invalid bug reporter name/);
  }
  assert.throws(() => bugIssue({...report, schema: 4}, origin), /identity\/schema/);
  assert.match(issue.body, /Chrome on Linux/); assert.ok(issue.body.endsWith(report.diagnostics_url));
  assert.ok(issue.body.length < 500);
  for (const excluded of ['PRIVATE_', '123456', '654321', '```', 'Pi investigation', 'rtt']) assert.ok(!issue.body.includes(excluded));
  report.diagnostics_url = 'http://169.254.169.254/latest/meta-data';
  assert.throws(() => bugIssue(report, origin), /Unexpected diagnostic/);
  report.diagnostics_url = fixture().diagnostics_url; report.message_untrusted = '@everyone <script> #1';
  assert.ok(!bugIssue(report, origin).body.includes('@everyone'));
});
function harness() {
  const report = fixture(), posts = [], issues = [], comments = [], logs = [], receipts = [], messages = [];
  let failure;
  const rest = {
    async get(route) {assert.equal(route, `/channels/${PUBLIC_BUG_CHANNEL_ID}/messages`); return messages;},
    async post(route, data) {
      assert.equal(route, `/channels/${PUBLIC_BUG_CHANNEL_ID}/messages`);
      if (failure === 'discord') {failure = null; throw Error('Discord unavailable');}
      const message = {id: '1560000000000000000', author: {id: 'bot'}, content: data.body.content, timestamp: new Date().toISOString()};
      posts.push(data); messages.push(message); return message;
    }
  };
  const request = async (url, options) => {
    if (url === report.diagnostics_url) {
      assert.ok(!options.headers?.authorization);
      if (failure === 'attachment') {failure = null; return new Response('', {status: 503});}
      return Response.json(report.diagnostics);
    }
    if (url.startsWith('https://api.github.com/')) {
      assert.equal(options.headers.authorization, 'Bearer github-secret');
      if (url === 'https://api.github.com/user') return Response.json({id: 42});
      if (/\/issues\/\d+\/comments/.test(url)) {
        if (options.method !== 'POST') return Response.json(comments);
        if (failure === 'comment') {failure = null; return new Response('', {status: 503});}
        const comment = {id: comments.length + 100, user: {id: 42}, ...JSON.parse(options.body)};
        comments.push(comment);
        if (failure === 'comment_response') {failure = null; throw Error('Lost comment response');}
        return Response.json(comment);
      }
      if (options.method === 'POST') {
        if (failure === 'github') {failure = null; return new Response('', {status: 503});}
        issues.push({number: issues.length + 1, ...JSON.parse(options.body)}); return Response.json(issues.at(-1));
      }
      return Response.json(issues);
    }
    assert.ok(url.startsWith('http://127.0.0.1:18923/internal/discord/bugs'));
    assert.equal(options.headers.authorization, 'Bearer game-secret');
    if (options.method === 'POST') {
      const receipt = JSON.parse(options.body);
      if (failure === receipt.target) {failure = null; return new Response('', {status: 503});}
      if (receipt.target === 'notes') {
        report.delivery.notes_through = receipt.through;
        report.delivery.note_comment_id = receipt.id;
        report.delivery.note_batch = null;
      } else report.delivery[receipt.target] = receipt.id;
      if (report.delivery.issue_number && report.delivery.public_message_id && (!report.notes || report.delivery.notes_through === report.notes.length)) report.delivery.status = 'delivered';
      receipts.push(receipt); return new Response(null, {status: 204});
    }
    if (report.delivery.status === 'delivered') return Response.json({report: null});
    if (report.notes && report.delivery.notes_through < report.notes.length && !report.delivery.note_batch) {
      report.delivery.note_batch = {from: report.delivery.notes_through + 1, through: report.notes.length};
    }
    return Response.json({report});
  };
  const publish = bugPublisher({rest, botId: 'bot', config: {url: 'http://127.0.0.1:18923/internal/discord/bugs', publicOrigin: origin, token: 'game-secret', githubToken: 'github-secret'}, request, log: (...args) => logs.push(args)});
  return {report, posts, issues, comments, logs, receipts, messages, publish, fail: value => {failure = value;}};
}
function addNote(h, text) {
  if (!h.report.notes) {h.report.notes = []; h.report.delivery.notes_through = 0;}
  h.report.notes.push({created_at_unix_ms: h.report.created_at_unix_ms + h.report.notes.length + 1, text_untrusted: text});
  h.report.delivery.status = 'pending';
}
test('one GitHub issue, plain full description and URL with previews suppressed, no private dump or files', async () => {
  const h = harness(); await h.publish(); await h.publish();
  assert.equal(h.posts.length, 1); assert.equal(h.issues.length, 1); assert.equal(h.receipts.length, 2);
  assert.deepEqual(h.posts[0], {body: {content: 'Reporter: BugWizard\nEnemies freeze, then catch up\nI can still move.\nhttps://github.com/OpenRotMG/Open-RotMG-Server/issues/1', flags: MessageFlags.SuppressEmbeds, allowed_mentions: {parse: []}, nonce: `u${'a'.repeat(24)}`, enforce_nonce: true}});
  assert.deepEqual(h.receipts.map(r => r.target), ['issue_number', 'public_message_id']);
});
test('notification preserves long descriptions while escaping markdown and mentions', async () => {
  const h = harness();
  h.report.reporter_name = '**@everyone**';
  h.report.message_untrusted = '**broken** @everyone\n' + '🐉'.repeat(480);
  await h.publish();
  assert.equal(h.posts[0].body.content, 'Reporter: \\*\\*@\u200beveryone\\*\\*\n\\*\\*broken\\*\\* @\u200beveryone\n' + '🐉'.repeat(480) + '\nhttps://github.com/OpenRotMG/Open-RotMG-Server/issues/1');
  assert.ok(h.posts[0].body.content.length <= 2000);
});
test('schema 2 spooled reports explicitly disclose the unrecorded name', async () => {
  const h = harness(); h.report.schema = 2; delete h.report.reporter_name;
  await h.publish();
  assert.match(h.issues[0].body, /Reporter:\*\* not recorded \(legacy report\)/);
  assert.ok(h.posts[0].body.content.startsWith('Reporter: not recorded (legacy report)\n'));
});
test('outages and lost receipts resume without duplicating issue or notification', async () => {
  for (const stage of ['attachment', 'github', 'issue_number', 'discord', 'public_message_id']) {
    const h = harness(); h.fail(stage); await h.publish();
    assert.ok(h.logs.some(([event]) => event === 'bug_delivery_failed'), stage);
    await h.publish(); assert.equal(h.posts.length, 1, stage); assert.equal(h.issues.length, 1, stage); assert.equal(h.receipts.length, 2, stage);
  }
});
test('reconciliation uses the final issue link, including legacy notifications', async () => {
  const url = 'https://github.com/OpenRotMG/Open-RotMG-Server/issues/1';
  for (const [content, posts] of [[`**#1: Old title**\n${url}`, 0], [`Plain report\n${url}`, 0], [`Report mentioning\n${url}\n${url}23`, 1]]) {
    const h = harness();
    h.messages.push({id: 'existing', author: {id: 'bot'}, content});
    await h.publish();
    assert.equal(h.posts.length, posts);
    assert.equal(h.report.delivery.public_message_id, posts ? '1560000000000000000' : 'existing');
  }
});
test('overlapping poll calls cannot publish duplicates', async () => {
  const h = harness(); await Promise.all([h.publish(), h.publish(), h.publish()]);
  assert.equal(h.posts.length, 1); assert.equal(h.issues.length, 1);
});
test('queued and later details become comments on one unchanged issue without extra Discord posts', async () => {
  const h = harness(), original = h.report.message_untrusted;
  addNote(h, 'First detail'); addNote(h, '**Second** @everyone\n🐉 detail');
  await h.publish();
  assert.equal(h.comments.length, 1);
  assert.match(h.comments[0].body, /^<!-- openrotmg-bug-info:a{24}:1:2 -->/);
  assert.match(h.comments[0].body, /> First detail/);
  assert.ok(h.comments[0].body.includes('\\*\\*Second\\*\\* @\u200beveryone'));
  assert.ok(!h.comments[0].body.includes('PRIVATE_'));
  assert.equal(h.report.delivery.notes_through, 2);
  addNote(h, 'Third detail after delivery'); await h.publish(); await h.publish();
  assert.equal(h.comments.length, 2); assert.equal(h.issues.length, 1); assert.equal(h.posts.length, 1);
  assert.equal(h.report.message_untrusted, original);
  assert.ok(!h.issues[0].body.includes('First detail'));
  assert.equal(h.report.delivery.notes_through, 3);
  assert.deepEqual(h.receipts.filter(r => r.target === 'notes').map(r => r.through), [2, 3]);
});
test('a frozen note batch survives outages and lost receipts while new notes arrive', async () => {
  for (const stage of ['comment', 'comment_response', 'notes']) {
    const h = harness(); addNote(h, 'First detail'); h.fail(stage); await h.publish();
    assert.ok(h.logs.some(([event]) => event === 'bug_delivery_failed'), stage);
    assert.deepEqual(h.report.delivery.note_batch, {from: 1, through: 1});
    addNote(h, 'Arrived during the outage'); await h.publish();
    assert.equal(h.comments.length, 1, stage); assert.equal(h.report.delivery.notes_through, 1, stage);
    await h.publish();
    assert.equal(h.comments.length, 2, stage); assert.equal(h.issues.length, 1, stage); assert.equal(h.posts.length, 1, stage);
    assert.match(h.comments[1].body, /:2:2 -->/); assert.ok(!h.comments[1].body.includes('First detail'));
    assert.equal(h.report.delivery.notes_through, 2, stage);
  }
});
test('comment reconciliation ignores another GitHub user copying the batch marker', async () => {
  const h = harness(); addNote(h, 'Real player detail');
  h.comments.push({id: 99, user: {id: 999}, body: `<!-- openrotmg-bug-info:${h.report.id}:1:1 -->\nForged`});
  await h.publish();
  assert.equal(h.comments.length, 2); assert.equal(h.report.delivery.note_comment_id, '101');
  assert.match(h.comments[1].body, /Real player detail/);
});
test('invalid note batch bounds fail explicitly without acknowledging details', async () => {
  const h = harness(); addNote(h, 'Detail'); h.report.delivery.note_batch = {from: 1, through: 2};
  await h.publish();
  assert.equal(h.comments.length, 0); assert.equal(h.report.delivery.notes_through, 0);
  assert.ok(h.logs.some(([event]) => event === 'bug_delivery_failed'));
});
test('configuration and required notification permissions fail explicitly', async () => {
  assert.equal(bugConfig({}, '', ''), null); assert.throws(() => bugConfig({BUG_REPORTING: 'false'}, '', ''));
  assert.throws(() => bugConfig({BUG_REPORTING: '1'}, '', ''));
  const client = {user: {id: 'bot'}, channels: {fetch: async () => ({guildId: 'guild', type: ChannelType.GuildText, permissionsFor: () => ({has: flag => flag !== PermissionFlagsBits.SendMessages})})}};
  await assert.rejects(validateBugChannels(client, 'guild'), /Missing bug-channel permission/);
});
