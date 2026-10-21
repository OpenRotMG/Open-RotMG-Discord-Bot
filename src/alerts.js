import {readFileSync, writeFileSync, renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Routes} from 'discord.js';

export function serverAlerts({rest, channelId, guildId, healthUrl, incidentUrl, token, statePath, log, request = fetch, now = Date.now}) {
  if (!/^\d{17,20}$/.test(channelId)) throw new Error('SERVER_ALERT_CHANNEL_ID must be a Discord text channel ID');
  let state;
  try { state = JSON.parse(readFileSync(statePath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = {schema: 1, open: null, seen: null}; }
  if (state?.schema !== 1 || !(state.seen === null || /^\d+-\d+$/.test(state.seen)) || !(state.open === null || (
    typeof state.open.id === 'string' && /^\d{17,20}$/.test(state.open.messageId) && ['since','lastNotice','reminders'].every(k => Number.isSafeInteger(state.open[k]) && state.open[k] >= 0)
  ))) throw new Error('Invalid persisted server alert state');
  let busy = false, previous = null, unhealthySince = null, healthySamples = 0;
  function save() {
    writeFileSync(`${statePath}.new`, JSON.stringify(state), {mode: 0o600, flush: true});
    renameSync(`${statePath}.new`, statePath);
  }
  async function send(key, content) {
    const nonce = createHash('sha256').update(key).digest('hex').slice(0, 24);
    const message = await rest.post(Routes.channelMessages(channelId), {body: {content, allowed_mentions: {parse: []}, nonce, enforce_nonce: true}});
    log('server_alert_sent', {channelId, messageId: message.id, key});
    return message.id;
  }
  async function json(url, headers = {}) {
    const response = await request(url, {headers, redirect: 'error', signal: AbortSignal.timeout(2000)});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  async function start(client) {
    const channel = await client.channels.fetch(channelId);
    if (channel.guildId !== guildId || channel.type !== 0) throw new Error('Server alert channel belongs to the wrong guild or is not a text channel');
    const member = await channel.guild.members.fetchMe();
    if (!channel.permissionsFor(member)?.has(['ViewChannel', 'SendMessages'])) throw new Error('Server alert channel requires View Channel and Send Messages for the bot');
    log('server_monitor_started', {channelId});
  }
  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const time = now();
      const [healthResult, incidentResult] = await Promise.allSettled([
        json(healthUrl), json(incidentUrl, {authorization: `Bearer ${token}`})
      ]);
      let problem = null, health = null, progressing = false;
      if (healthResult.status === 'rejected') problem = `Health unavailable (${healthResult.reason.message})`;
      else {
        health = healthResult.value;
        if (!['tick','process','uptime_seconds'].every(k => Number.isSafeInteger(health?.[k]) && health[k] >= 0) || typeof health.paused !== 'boolean') {
          problem = 'Malformed health response';
          health = null;
        } else {
          progressing = previous?.process === health.process && previous.tick !== health.tick;
          if (!previous || previous.process !== health.process || previous.tick !== health.tick || health.paused) previous = {process: health.process, tick: health.tick, at: time};
          if (time - previous.at >= 30000) problem = 'Simulation ticks stopped advancing';
        }
      }
      let failure = null;
      try {
        if (incidentResult.status === 'rejected') throw new Error(`Critical incident feed unavailable (${incidentResult.reason.message})`);
        failure = incidentResult.value.incident;
        if (failure !== null && (!/^\d+-\d+$/.test(failure?.id) || !['world','persistence'].includes(failure.component) || !['panicked','failed','exited'].includes(failure.failure)
          || !Number.isSafeInteger(failure.unix_ms) || !(failure.revision === null || /^[a-f0-9]{40}$/.test(failure.revision))
          || !(failure.location === null || /^[A-Za-z0-9_./-]{1,180}:\d+:\d+$/.test(failure.location)))) throw new Error('Malformed critical incident response');
        if (failure) {
          const context = failure.context;
          if (!context || ![context.world,context.tick,...(context.npc ?? [])].every(v => v === null || Number.isSafeInteger(v))) throw new Error('Malformed incident context');
        }
      } catch (error) {
        log('server_incident_read_failed', {error: error.message});
        problem ??= `Monitoring impaired: ${error.message}`;
        failure = null;
      }
      if (failure && state.seen !== failure.id) {
        const context = failure.context;
        const detail = `Critical ${failure.component} worker ${failure.failure}\nRevision: ${failure.revision ?? 'unavailable'}\nSource: ${failure.location ?? 'not captured'}\nWorld/tick/NPC: ${JSON.stringify({world: context.world, tick: context.tick, npc: context.npc})}\nFailure time: ${new Date(failure.unix_ms).toISOString()}\nDetails and backtrace remain in the private server journal.`;
        if (!state.open) {
          const id = `critical-${failure.id}`;
          const messageId = await send(id, `🔴 Server incident ${id}\n${detail}`);
          state.open = {id, messageId, since: failure.unix_ms, lastNotice: time, reminders: 0};
        } else {
          await rest.patch(Routes.channelMessage(channelId, state.open.messageId), {body: {content: `🔴 Server incident ${state.open.id}\n${detail}`, allowed_mentions: {parse: []}}});
        }
        state.seen = failure.id;
        healthySamples = 0;
        save();
      }
      if (problem) {
        healthySamples = 0;
        unhealthySince ??= time;
        // A frozen tick is already thirty seconds of evidence; transport failures get a startup/deploy grace.
        if (!state.open && (problem === 'Simulation ticks stopped advancing' || time - unhealthySince >= 30000)) {
          const id = `health-${unhealthySince}`;
          const messageId = await send(id, `🔴 Server incident ${id}\n${problem}\nEndpoint: ${healthUrl}\nRevision: ${health?.revision ?? 'unavailable'}`);
          state.open = {id, messageId, since: unhealthySince, lastNotice: time, reminders: 0};
          save();
        }
      } else {
        unhealthySince = null;
        healthySamples = progressing ? healthySamples + 1 : 0;
        if (state.open && healthySamples >= 2) {
          await send(`${state.open.id}-recovered`, `🟢 Server incident ${state.open.id}: recovered\nHealth responds and simulation ticks advance. Revision: ${health.revision ?? 'unavailable'}.\nElapsed since incident: ${Math.round((time-state.open.since)/1000)}s. This does not prove lost progress was recovered.`);
          state.open = null;
          save();
        }
      }
      if (state.open && state.open.reminders < 3 && time - state.open.lastNotice >= 900000) {
        await send(`${state.open.id}-reminder-${state.open.reminders}`, `🔴 Server incident ${state.open.id} is still open. ${problem ?? 'Awaiting stable recovery'}`);
        state.open.reminders += 1;
        state.open.lastNotice = time;
        save();
      }
    } finally { busy = false; }
  }
  return {start, poll};
}
