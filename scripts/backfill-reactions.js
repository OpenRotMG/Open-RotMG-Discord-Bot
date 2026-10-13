import {readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {REST, Routes} from 'discord.js';
import {reactionConfig, postReactor, backfillReactions} from '../src/reactions.js';

const {DISCORD_APPLICATION_ID: applicationId, DISCORD_BOT_TOKEN_FILE: tokenFile} = process.env;
if (!/^\d{17,20}$/.test(applicationId) || !tokenFile || !isAbsolute(tokenFile)) throw new Error('Expected application ID and absolute token file are required');
const config = reactionConfig(process.env);
const token = readFileSync(tokenFile, 'utf8').trim();
if (!token) throw new Error('Bot token file is empty');
const rest = new REST({version: '10'}).setToken(token);
const log = (event, fields) => console.log(JSON.stringify({time: new Date().toISOString(), event, ...fields}));
try {
  const me = await rest.get(Routes.user());
  if (me.id !== applicationId || !me.bot) throw new Error('Token belongs to a different bot');
  const react = await postReactor(rest, config, log);
  const channels = await backfillReactions(rest, config, react, log);
  log('reaction_backfill_complete', {botId: me.id, emojiId: config.emojiId, channels});
} catch (err) {
  log('reaction_backfill_failed', {error: {code: err.code, message: String(err.message).replaceAll(token, '[REDACTED]')}});
  process.exitCode = 1;
}
