import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Client, Events, GatewayIntentBits, Routes } from 'discord.js';
import { openStore } from './store.js';
import { handleMessage, handleInteraction } from './bot.js';

process.umask(0o077);
const {DISCORD_APPLICATION_ID: applicationId, DISCORD_GUILD_ID: guildId, DISCORD_BOT_TOKEN_FILE: tokenFile, DATABASE_PATH: databasePath} = process.env;
if (!/^\d{17,20}$/.test(applicationId)) throw new Error('DISCORD_APPLICATION_ID must be the expected bot application ID');
if (!/^\d{17,20}$/.test(guildId)) throw new Error('DISCORD_GUILD_ID must be a Discord server ID');
if (!tokenFile || !isAbsolute(tokenFile)) throw new Error('DISCORD_BOT_TOKEN_FILE must be an absolute path');
if (!databasePath || !isAbsolute(databasePath)) throw new Error('DATABASE_PATH must be an absolute path');
const token = readFileSync(tokenFile, 'utf8').trim();
if (!token) throw new Error('Bot token file is empty');
const store = openStore(databasePath);
const client = new Client({intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]});
const context = {store, guildId};
let enabled = false;
function log(event, fields = {}) {
  console.log(JSON.stringify({time: new Date().toISOString(), event, ...fields}));
}
function error(event, err, fields = {}) {
  log(event, {...fields, error: {name: err.name, code: err.code, message: String(err.message).replaceAll(token, '[REDACTED]')}});
}
client.on(Events.MessageCreate, message => {
  if (!enabled) return;
  handleMessage(message, context).catch(err => error('message_failed', err, {guildId: message.guildId, messageId: message.id, userId: message.author.id}));
});
client.on(Events.InteractionCreate, interaction => {
  if (!enabled) return;
  handleInteraction(interaction, context).catch(async err => {
    error('interaction_failed', err, {interactionId: interaction.id, userId: interaction.user.id});
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      try { await interaction.reply({content: 'Could not load your level. The error has been logged.', flags: 64}); }
      catch (replyError) { error('error_reply_failed', replyError); }
    }
  });
});
client.on(Events.Error, err => error('gateway_error', err));
client.on(Events.ShardReconnecting, shardId => log('gateway_reconnecting', {shardId}));
client.on(Events.ShardResume, shardId => log('gateway_resumed', {shardId}));
client.on(Events.ShardDisconnect, (close, shardId) => log('gateway_disconnected', {shardId, code: close.code}));
const ready = new Promise(resolve => client.once(Events.ClientReady, resolve));
const startupDeadline = setTimeout(() => {log('startup_timeout'); process.exit(1);}, 60000);
try {
  await client.login(token);
  await ready;
  if (client.user.id !== applicationId) throw new Error('Bot token belongs to a different application');
  if (!client.guilds.cache.has(guildId)) throw new Error(`Bot is not installed in configured guild ${guildId}`);
  await client.rest.put(Routes.applicationGuildCommands(client.user.id, guildId), {
    body: [{name: 'level', description: 'View your level, XP, and the server leaderboard', type: 1}],
  });
} catch (err) {
  error('startup_failed', err); client.destroy(); store.close();
  process.exit(1);
}
clearTimeout(startupDeadline);
enabled = true;
log('ready', {botId: client.user.id, guildId});
const heartbeat = setInterval(() => log('heartbeat', {guildId, gatewayStatus: client.ws.status}), 60000);
function stop(signal) {
  log('stopping', {signal}); clearInterval(heartbeat); client.destroy(); store.close();
}
process.once('SIGTERM', () => stop('SIGTERM'));
process.once('SIGINT', () => stop('SIGINT'));
