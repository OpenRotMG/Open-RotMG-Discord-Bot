import assert from 'node:assert/strict';
import {setImmediate as flush} from 'node:timers/promises';
import test from 'node:test';
import {watchRealmTickChannel} from '../src/realm-tick.js';

test('renames one channel every ten minutes only when the tick or availability changes', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const channelId = '1575198201408004277';
  const channel = {guild_id: 'guild', type: 0, name: 'busiest-tick-avg'};
  const writes = [], errors = [];
  let mean = 13750;
  const options = {
    guildId: 'guild', channelId,
    rest: {
      get: async route => {
        assert.equal(route, `/channels/${channelId}`);
        return {...channel};
      },
      patch: async (route, {body}) => {
        assert.equal(route, `/channels/${channelId}`);
        writes.push(channel.name = body.name);
      },
    },
    readHealth: async () => ({busiest_realm_tick_mean_us: mean}),
    log() {},
    error: (event, err) => errors.push([event, err.message]),
  };
  let stop = watchRealmTickChannel(options);
  await flush();
  assert.deepEqual(writes, ['busiest-tick-avg-14ms']);
  mean = 11100;
  stop();
  stop = watchRealmTickChannel(options);
  t.after(() => stop());
  await flush();
  t.mock.timers.tick(599999);
  await flush();
  assert.equal(writes.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(writes.at(-1), 'busiest-tick-avg-11ms');
  t.mock.timers.tick(600000);
  await flush();
  assert.equal(writes.length, 2);
  mean = null;
  t.mock.timers.tick(600000);
  await flush();
  assert.equal(writes.at(-1), 'busiest-tick-avg-unavailable');
  assert.deepEqual(errors, []);
  mean = undefined;
  t.mock.timers.tick(600000);
  await flush();
  assert.deepEqual(errors, [['realm_tick_sample_failed', 'Invalid busiest_realm_tick_mean_us in game health']]);
  channel.guild_id = 'other guild';
  mean = 13500;
  t.mock.timers.tick(600000);
  await flush();
  assert.equal(errors.at(-1)[0], 'realm_tick_channel_failed');
  assert.equal(writes.length, 3);
});
