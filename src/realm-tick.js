import {ChannelType, Routes} from 'discord.js';

const prefix = 'busiest-tick-avg';
const intervalMs = 10 * 60 * 1000;

export function watchRealmTickChannel({rest, guildId, channelId, readHealth, log, error}) {
  if (!/^\d{17,20}$/.test(channelId)) throw new Error('REALM_TICK_CHANNEL_ID must be a Discord text channel ID');
  const route = Routes.channel(channelId);
  let stopped = false;
  let timer;
  async function poll(initial = false) {
    try {
      const channel = await rest.get(route);
      if (channel.guild_id !== guildId || channel.type !== ChannelType.GuildText) throw new Error('Realm tick channel must be a text channel in the configured guild');
      // Publish immediately on first setup, but don't use a restart to bypass the rename cadence.
      if (stopped || (initial && channel.name !== prefix)) return;
      let value = 'unavailable';
      try {
        const mean = (await readHealth()).busiest_realm_tick_mean_us;
        if (mean !== null) {
          if (!Number.isSafeInteger(mean) || mean < 0) throw new Error('Invalid busiest_realm_tick_mean_us in game health');
          value = `${Math.round(mean / 1000)}ms`;
        }
      } catch (err) {
        error('realm_tick_sample_failed', err, {channelId});
      }
      if (stopped) return;
      const name = `${prefix}-${value}`;
      const changed = name !== channel.name;
      if (changed) await rest.patch(route, {body: {name}, reason: 'Busiest Realm tick telemetry'});
      log('realm_tick_channel_checked', {channelId, name, changed});
    } catch (err) {
      error('realm_tick_channel_failed', err, {channelId});
    } finally {
      if (!stopped) timer = setTimeout(poll, intervalMs);
    }
  }
  void poll(true);
  return () => { stopped = true; clearTimeout(timer); };
}
