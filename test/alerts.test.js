import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {serverAlerts} from '../src/alerts.js';

test('reports a failed shutdown worker instead of treating the incident feed as malformed', async () => {
  const sent = [], logs = [];
  const incident = {id: '44396-1795815247262', unix_ms: 1795815247262, process: 44396, revision: '096a695fa98a2d9d355e1fd7a19b4bf7f1f05d91', component: 'shutdown', failure: 'failed', location: null, context: {world: null, tick: null, npc: null}};
  const responses = {health: {tick: 1, process: 2, uptime_seconds: 3, paused: false}, incident: {incident}};
  const alerts = serverAlerts({
    rest: {post: async (_, {body}) => { sent.push(body.content); return {id: '1575964069192540253'}; }},
    channelId: '1560433709088383026', guildId: 'guild', healthUrl: 'health', incidentUrl: 'incident', token: 'token',
    statePath: join(mkdtempSync(join(tmpdir(), 'alerts-')), 'state.json'),
    log: (event, data) => logs.push([event, data]),
    request: async url => ({ok: true, json: async () => responses[url]}),
  });
  await alerts.poll();
  assert.deepEqual(logs.filter(([event]) => event === 'server_incident_read_failed'), []);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Critical shutdown worker failed/);
});
