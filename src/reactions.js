import { ChannelType, Routes } from 'discord.js';

export function reactionConfig(env) {
  const config = {
    guildId: env.DISCORD_GUILD_ID,
    channelIds: [env.ANNOUNCEMENTS_CHANNEL_ID, env.UPDATE_BLOG_CHANNEL_ID],
    emojiId: env.AMULET_EMOJI_ID,
  };
  if (![config.guildId, ...config.channelIds, config.emojiId].every(id => /^\d{17,20}$/.test(id))) {
    throw new Error('Reaction guild, ANNOUNCEMENTS_CHANNEL_ID, UPDATE_BLOG_CHANNEL_ID and AMULET_EMOJI_ID must be Discord IDs');
  }
  if (config.channelIds[0] === config.channelIds[1]) throw new Error('Reaction channels must be distinct');
  return config;
}

export async function postReactor(rest, config, log) {
  for (const [i, id] of config.channelIds.entries()) {
    const channel = await rest.get(Routes.channel(id));
    if (channel.guild_id !== config.guildId || channel.name !== ['announcements', 'update-blog'][i]
        || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
      throw new Error(`Reaction channel ${id} is not the expected server post channel`);
    }
  }
  const emojis = await rest.get(Routes.guildEmojis(config.guildId));
  const emoji = emojis.find(e => e.id === config.emojiId);
  if (!emoji || !emoji.available) throw new Error(`Reaction emoji ${config.emojiId} is not available in the configured server`);
  const encodedEmoji = encodeURIComponent(`${emoji.name}:${emoji.id}`);
  return async message => {
    if (message.guildId !== config.guildId || !config.channelIds.includes(message.channelId)) return false;
    await rest.put(Routes.channelMessageOwnReaction(message.channelId, message.id, encodedEmoji));
    log('post_reacted', {channelId: message.channelId, messageId: message.id, emojiId: emoji.id});
    return true;
  };
}

export async function backfillReactions(rest, config, react, log) {
  const results = [];
  for (const channelId of config.channelIds) {
    let before;
    const result = {channelId, scanned: 0, added: 0, alreadyReacted: 0};
    for (;;) {
      const query = new URLSearchParams({limit: '100'});
      if (before) query.set('before', before);
      const messages = await rest.get(Routes.channelMessages(channelId), {query});
      if (!Array.isArray(messages) || messages.length > 100) throw new Error(`Invalid history page for ${channelId}`);
      if (messages.length === 0) break;
      let cursor = before;
      for (const message of messages) {
        if (!/^\d{17,20}$/.test(message.id) || message.channel_id !== channelId
            || (cursor && BigInt(message.id) >= BigInt(cursor))) {
          throw new Error(`Invalid history cursor/message in ${channelId}`);
        }
        cursor = message.id;
        result.scanned++;
        if (message.reactions?.some(r => r.emoji.id === config.emojiId && r.me)) result.alreadyReacted++;
        else {
          await react({guildId: config.guildId, channelId, id: message.id});
          result.added++;
        }
      }
      before = cursor;
      log('reaction_backfill_page', {...result, before});
    }
    results.push(result);
    log('reaction_backfill_channel_complete', result);
  }
  return results;
}
