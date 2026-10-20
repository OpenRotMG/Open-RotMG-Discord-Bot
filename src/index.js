import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Client, Events, GatewayIntentBits, Routes } from 'discord.js';
import { openStore } from './store.js';
import { handleMessage, handleInteraction, replyInteractionError } from './bot.js';
import { COMMANDS } from './commands.js';
import { statusUrl, readGameStatus } from './status.js';
import { reactionConfig, postReactor } from './reactions.js';
import { bugConfig, bugPublisher, validateBugChannels } from './bugs.js';
import {gameJson, setupBoards, refreshBoards} from './hiscores.js';
import {syncUpdates} from './updates.js';

process.umask(0o077);
const {DISCORD_APPLICATION_ID: applicationId, DISCORD_GUILD_ID: guildId, DISCORD_BOT_TOKEN_FILE: tokenFile, DATABASE_PATH: databasePath} = process.env;
if (!/^\d{17,20}$/.test(applicationId)) throw new Error('DISCORD_APPLICATION_ID must be the expected bot application ID');
if (!/^\d{17,20}$/.test(guildId)) throw new Error('DISCORD_GUILD_ID must be a Discord server ID');
const announceRoleId = process.env.ANNOUNCE_ROLE_ID;
if (!/^\d{17,20}$/.test(announceRoleId)) throw new Error('ANNOUNCE_ROLE_ID must be the Moderator role ID');
if (!tokenFile || !isAbsolute(tokenFile)) throw new Error('DISCORD_BOT_TOKEN_FILE must be an absolute path');
if (!databasePath || !isAbsolute(databasePath)) throw new Error('DATABASE_PATH must be an absolute path');
const token = readFileSync(tokenFile, 'utf8').trim();
if (!token) throw new Error('Bot token file is empty');
const gameStatusUrl = statusUrl(process.env.GAME_STATUS_URL);
const reactions = reactionConfig(process.env);
const linkTokenFile = process.env.DISCORD_LINK_TOKEN_FILE;
if (!linkTokenFile || !isAbsolute(linkTokenFile)) throw new Error('DISCORD_LINK_TOKEN_FILE must be an absolute path');
const linkToken = readFileSync(linkTokenFile, 'utf8').trim();
if (!/^[a-f0-9]{64}$/.test(linkToken)) throw new Error('Invalid private link API credential');
if (!process.env.GAME_API_URL) throw new Error('GAME_API_URL is required');
const gameEndpoint = new URL(process.env.GAME_API_URL);
if (gameEndpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(gameEndpoint.hostname) || !gameEndpoint.port || gameEndpoint.pathname !== '/' || gameEndpoint.username || gameEndpoint.password || gameEndpoint.search || gameEndpoint.hash) throw new Error('GAME_API_URL requires an explicit HTTP loopback origin');
const gameOrigin = gameEndpoint.origin;
const bugs = bugConfig(process.env, gameOrigin, linkToken);
const site = 'https://openrotmg.org/';
const store = openStore(databasePath);
const client = new Client({intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]});
const context = {store, guildId, announceRoleId,
  announceGame: text => gameJson(`${gameOrigin}/internal/discord/announce`, {body: {text}, token: linkToken, timeout: 20000}),
  kickGame: discord_id => gameJson(`${gameOrigin}/internal/discord/kick`, {body: {discord_id}, token: linkToken, timeout: 20000}),
  recoverGame: (code, discord_id) => gameJson(`${gameOrigin}/internal/discord/recover`, {body: {discord_id, ...(code ? {code} : {})}, token: linkToken}),
  linkGame: discord_id => gameJson(`${gameOrigin}/internal/discord/link/start`, {body: {discord_id}, token: linkToken}), gameStatus: async () => {
  const status = await readGameStatus(gameStatusUrl);
  if (!status.online) log('game_status_down', status.reason);
  return status;
}};
let enabled = false;
let react;
let boards;
function log(event, fields = {}) {
  console.log(JSON.stringify({time: new Date().toISOString(), event, ...fields}));
}
function error(event, err, fields = {}) {
  log(event, {...fields, error: {name: err.name, code: err.code, message: String(err.message).replaceAll(token, '[REDACTED]').replaceAll(linkToken, '[REDACTED]')}});
}
client.on(Events.MessageCreate, message => {
  if (!enabled) return;
  handleMessage(message, context).catch(err => error('message_failed', err, {guildId: message.guildId, messageId: message.id, userId: message.author.id}));
  react(message).catch(err => error('reaction_failed', err, {channelId: message.channelId, messageId: message.id}));
});
client.on(Events.InteractionCreate, interaction => {
  if (!enabled) return;
  handleInteraction(interaction, context).catch(async err => {
    error('interaction_failed', err, {interactionId: interaction.id, userId: interaction.user.id, commandName: interaction.commandName});
    try { await replyInteractionError(interaction); }
    catch (replyError) { error('error_reply_failed', replyError); }
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
  react = await postReactor(client.rest, reactions, log);
  if (bugs) await validateBugChannels(client, guildId);
  boards = await setupBoards(client.rest, {guildId, categoryId: process.env.HISCORES_CATEGORY_ID, botId: client.user.id, site});
  await client.rest.put(Routes.applicationGuildCommands(client.user.id, guildId), {
    body: COMMANDS,
  });
} catch (err) {
  error('startup_failed', err); client.destroy(); store.close();
  process.exit(1);
}
clearTimeout(startupDeadline);
enabled = true;
log('ready', {botId: client.user.id, guildId, reactionChannelIds: reactions.channelIds, reactionEmojiId: reactions.emojiId});
let refreshing = false;
async function updateHiscores() {
  if (refreshing) return;
  refreshing = true;
  try { await refreshBoards(client.rest, boards, await gameJson(`${gameOrigin}/api/hiscores`), site); }
  catch (err) { error('hiscores_refresh_failed', err); }
  finally { refreshing = false; }
}
await updateHiscores();
const hiscoreTimer = setInterval(updateHiscores, 60000);
let syncingUpdates = false;
async function updateNews() {
  if (syncingUpdates) return;
  syncingUpdates = true;
  try {
    await syncUpdates({rest: client.rest, guildId, channelId: reactions.channelIds[1], log,
      publish: body => gameJson(`${gameOrigin}/internal/discord/updates`, {body, token: linkToken, timeout: 10000})});
  } catch (err) { error('updates_sync_failed', err, {channelId: reactions.channelIds[1]}); }
  finally { syncingUpdates = false; }
}
await updateNews();
const updateTimer = setInterval(updateNews, 60000);
const publishBugs = bugs ? bugPublisher({rest: client.rest, botId: client.user.id, config: bugs, log}) : null;
const bugTimer = publishBugs ? setInterval(publishBugs, 5000) : null;
if (publishBugs) void publishBugs();
else log('bug_reporting_disabled', {reason: 'BUG_REPORTING is not set'});
const heartbeat = setInterval(() => log('heartbeat', {guildId, gatewayStatus: client.ws.status}), 60000);
function stop(signal) {
  log('stopping', {signal}); clearInterval(heartbeat); clearInterval(hiscoreTimer); clearInterval(updateTimer); clearInterval(bugTimer); client.destroy(); store.close();
}
process.once('SIGTERM', () => stop('SIGTERM'));
process.once('SIGINT', () => stop('SIGINT'));
