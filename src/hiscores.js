import {Routes, ChannelType, PermissionFlagsBits} from 'discord.js';

export const categories = [
  {name: 'living-fame', metric: 'base_fame', title: 'Living fame', rule: 'Highest fame of an alive character per account.'},
  {name: 'collection', metric: 'collection', title: 'Collection', rule: 'Items personally picked up from enemy drops'},
  {name: 'total-fame', metric: 'total_fame', title: 'Total fame', rule: 'Available account fame. Earned from dead characters and reduced when spent.'}
];
const marker = 'Open RotMG hiscores';
export function validateScores(data) {
  if (!data || !Number.isSafeInteger(data.updated_at) || !Array.isArray(data.players)) throw new Error('Malformed hiscores response');
  const accounts = new Set();
  for (const p of data.players) {
    if (!Number.isSafeInteger(p.account) || p.account < 1 || accounts.has(p.account) || typeof p.name !== 'string' || !/^[A-Za-z][A-Za-z0-9]{2,14}$/.test(p.name) || !(p.discord_id === null || /^\d{17,20}$/.test(p.discord_id)) || categories.some(c => !Number.isSafeInteger(p[c.metric]) || p[c.metric] < 0)) throw new Error('Malformed hiscores player');
    accounts.add(p.account);
  }
  return data;
}
export function boardMessage(players, category, site) {
  const sorted = [...players].sort((a, b) => b[category.metric] - a[category.metric] || a.account - b.account).slice(0, 10);
  let previous, rank = 0;
  const lines = sorted.map((p, i) => {
    if (previous !== p[category.metric]) rank = i + 1; previous = p[category.metric];
    return `**${rank}.** ${p.name}${p.discord_id ? ` · <@${p.discord_id}>` : ''} - **${p[category.metric].toLocaleString('en-US')}**`;
  });
  return {embeds: [{title: `${category.title} · Top 10`, description: `${category.rule}\n\n${lines.length ? lines.join('\n') : 'No ranked players yet. Sign into a registered game account to enter.'}\n\n${site}hiscores/?board=${category.metric}`, color: 0xd9b64a, footer: {text: marker}}], allowed_mentions: {parse: []}};
}
export function boardOverwrites(parent, guildId, botId) {
  const blocked = PermissionFlagsBits.SendMessages | PermissionFlagsBits.SendMessagesInThreads | PermissionFlagsBits.CreatePublicThreads | PermissionFlagsBits.CreatePrivateThreads;
  const allowed = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.EmbedLinks;
  // Explicit channel overrides must not discard the category's read restrictions.
  const rules = parent.permission_overwrites.map(o => ({...o, allow: (BigInt(o.allow) & ~blocked).toString(), deny: (BigInt(o.deny) | blocked).toString()}));
  for (const [id, type] of [[guildId, 0], [botId, 1]]) {
    if (!rules.some(o => o.id === id)) rules.push({id, type, allow: '0', deny: blocked.toString()});
  }
  const bot = rules.find(o => o.id === botId);
  bot.allow = (BigInt(bot.allow) | allowed).toString();bot.deny = (BigInt(bot.deny) & ~allowed).toString();
  return rules;
}
export async function setupBoards(rest, {guildId, categoryId, botId, site, create = false}) {
  if (!/^\d{17,20}$/.test(categoryId)) throw new Error('HISCORES_CATEGORY_ID must be a Discord category ID');
  const channels = await rest.get(Routes.guildChannels(guildId));
  const parent = channels.find(c => c.id === categoryId);
  if (!parent || parent.type !== ChannelType.GuildCategory || parent.name !== 'Hiscores') throw new Error('Expected the configured Hiscores category');
  const boards = [];
  for (const category of categories) {
    const matches = channels.filter(c => c.parent_id === categoryId && c.name === category.name);
    if (matches.length > 1) throw new Error(`Duplicate ${category.name} hiscore channels`);
    let channel = matches[0];
    if (!channel) {
      if (!create) throw new Error(`Missing #${category.name}; run the explicit hiscores setup command`);
      channel = await rest.post(Routes.guildChannels(guildId), {body: {name: category.name, type: ChannelType.GuildText, parent_id: categoryId, topic: category.rule, permission_overwrites: boardOverwrites(parent, guildId, botId)}});
    }
    if (channel.type !== ChannelType.GuildText) throw new Error(`Expected #${category.name} to be a text channel`);
    const history = await rest.get(Routes.channelMessages(channel.id), {query: new URLSearchParams({limit: '100'})});
    const managed = history.filter(m => m.author.id === botId && m.embeds?.some(e => e.footer?.text === marker));
    if (managed.length > 1) throw new Error(`Multiple managed messages in #${category.name}`);
    let message = managed[0];
    if (!message) {
      if (history.length === 100) throw new Error(`#${category.name} has uninspected older messages; refusing to create a potential duplicate`);
      if (!create) throw new Error(`Missing permanent message in #${category.name}; run the explicit hiscores setup command`);
      message = await rest.post(Routes.channelMessages(channel.id), {body: boardMessage([], category, site)});
    }
    if (category.metric === 'base_fame' && channel.topic !== category.rule) await rest.patch(Routes.channel(channel.id), {body: {topic: category.rule}});
    boards.push({category, channelId: channel.id, messageId: message.id, previous: null});
  }
  return boards;
}
export async function refreshBoards(rest, boards, data, site) {
  validateScores(data);
  for (const board of boards) {
    const message = boardMessage(data.players, board.category, site), encoded = JSON.stringify(message);
    if (board.previous !== encoded) {
      await rest.patch(Routes.channelMessage(board.channelId, board.messageId), {body: message});
      board.previous = encoded;
    }
  }
}
export async function gameJson(url, {body, token, fetchImpl = fetch, timeout = 3000} = {}) {
  const response = await fetchImpl(url, {method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(timeout), headers: body ? {'content-type': 'application/json', authorization: `Bearer ${token}`} : {}, ...(body ? {body: JSON.stringify(body)} : {})});
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Game API failed (${response.status})`);
  return data;
}
