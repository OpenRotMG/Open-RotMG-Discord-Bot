import { MAX_LEVEL, xpForLevel, levelForXp } from './xp.js';

function escapeName(name) {
  const raw = name.replace(/[\r\n]+/g, ' ').trim();
  const short = raw.length > 24 ? `${raw.slice(0, 24)}…` : raw;
  return short.replace(/[\\*_~`|>]/g, '\\$&');
}

export function buildLevel(store, guildId, userId, requestedPage) {
  if (requestedPage !== undefined && (!Number.isSafeInteger(requestedPage) || requestedPage < 0)) {
    throw new Error('Invalid leaderboard page');
  }
  const me = store.me(guildId, userId);
  if (!me) return {embeds: [{title: 'No XP yet', description: "You haven't earned any XP yet. Chat in the server to start leveling up!", color: 0x5865f2}]};
  const last = Math.ceil(me.total / 10) - 1;
  // Existing cards can outlive the rows that defined their last page.
  const current = Math.min(requestedPage ?? Math.floor((me.position - 1) / 10), last);
  const rows = store.page(guildId, current * 10);
  const value = rows.map(row => {
    const line = `\`#${row.rank}\` ${escapeName(row.username)} — Lvl ${levelForXp(row.xp)} (${row.xp} XP)`;
    return row.user_id === userId ? `▶ **${line}**` : line;
  }).join('\n');
  if (value.length > 1024) throw new Error('Leaderboard exceeds Discord embed limit');
  const level = levelForXp(me.xp);
  const result = {embeds: [{
    title: '📊 Your Level', description: `Ranked **#${me.rank}** of **${me.total}** on the server`, color: 0x5865f2,
    fields: [
      {name: 'Level', value: String(level), inline: true},
      {name: 'Total XP', value: String(me.xp), inline: true},
      {name: 'XP to next level', value: level === MAX_LEVEL ? 'Max level 🎉' : String(xpForLevel(level + 1) - me.xp), inline: true},
      {name: 'Leaderboard', value},
    ], footer: {text: `Page ${current + 1} of ${last + 1}`},
  }]};
  if (last > 0) result.components = [{type: 1, components: [
    {type: 2, style: 2, label: '◀ Prev', custom_id: `lvl:${Math.max(0, current - 1)}`, disabled: current === 0},
    {type: 2, style: 2, label: 'Next ▶', custom_id: `lvl:${Math.min(last, current + 1)}`, disabled: current === last},
    {type: 2, style: 1, label: 'Go to page…', custom_id: `lvl:jump:${last}`},
  ]}];
  return result;
}

export function jumpModal(last) {
  return {custom_id: 'lvl:go', title: 'Jump to a leaderboard page', components: [{type: 1, components: [{
    type: 4, custom_id: 'page', label: `Page number (1-${last + 1})`, style: 1, required: true, max_length: 4,
  }]}]};
}
