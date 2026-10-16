import {Routes} from 'discord.js';

const id = value => typeof value === 'string' && /^[1-9]\d{16,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;
export function plainText(content) {
  return content.replace(/\r\n?/g, '\n')
    .replace(/@everyone\b[ \t]*/g, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/<a?:([A-Za-z0-9_]+):\d+>/g, ':$1:')
    .replace(/\*\*|__|~~|`{1,3}/g, '')
    .replace(/\*([^*\n]+)\*/g, '$1').trim();
}
export async function syncUpdates({rest, guildId, channelId, publish, log}) {
  if (!id(guildId) || !id(channelId)) throw new Error('Invalid update feed source');
  const messages = await rest.get(Routes.channelMessages(channelId), {query: new URLSearchParams({limit: '100'})});
  if (!Array.isArray(messages) || messages.length > 100) throw new Error('Invalid update history page');
  const posts = [];
  let previous;
  let skipped = 0;
  for (const message of messages) {
    if (!id(message.id) || message.channel_id !== channelId || (previous && BigInt(message.id) >= BigInt(previous))
        || typeof message.content !== 'string' || !Array.isArray(message.attachments) || !Array.isArray(message.embeds)) {
      throw new Error('Invalid update history message');
    }
    previous = message.id;
    if (![0, 19].includes(message.type)) {skipped++; continue;}
    let content = plainText(message.content);
    if (message.attachments.length > 10) throw new Error('Too many update attachments');
    const attachments = message.attachments.map(a => {
      if (!a || typeof a.filename !== 'string' || !a.filename.trim() || a.filename.length > 256
          || typeof a.url !== 'string' || a.url.length > 2048
          || !/^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\/[^\s#\x00-\x1f\x7f-\x9f]+$/.test(a.url)
          || !(a.content_type === undefined || (typeof a.content_type === 'string' && /^[\x20-\x7e]{1,128}$/.test(a.content_type)))) throw new Error('Invalid update attachment');
      return {filename: a.filename, url: a.url, content_type: a.content_type ?? null};
    });
    if (!content && attachments.length) content = attachments.map(a => a.filename).join(', ');
    if (!content) {
      if (message.embeds.length) throw new Error(`Update ${message.id} has only embeds; add post text before publishing`);
      skipped++; continue;
    }
    const published_at = Date.parse(message.timestamp) / 1000;
    const edited_at = message.edited_timestamp === null ? null : Date.parse(message.edited_timestamp) / 1000;
    if (!Number.isFinite(published_at) || published_at < 1 || published_at > 2147483647
        || (edited_at !== null && (!Number.isFinite(edited_at) || edited_at < published_at || edited_at > 2147483647))
        || content.length > 8000 || /[\x00-\x08\x0b-\x1f\x7f-\x9f\ufffe\uffff]/.test(content)) throw new Error(`Invalid update content/timestamp: ${message.id}`);
    posts.push({id: message.id, content, attachments, published_at: Math.floor(published_at), edited_at: edited_at === null ? null : Math.floor(edited_at)});
  }
  const result = await publish({guild_id: guildId, channel_id: channelId, posts});
  if (!Number.isSafeInteger(result.synced_at) || result.source?.guild_id !== guildId || result.source?.channel_id !== channelId
      || !Array.isArray(result.source.posts) || result.source.posts.length !== posts.length) throw new Error('Invalid update sync receipt');
  log('updates_synced', {channelId, posts: posts.length, skipped, syncedAt: result.synced_at});
  return result;
}
