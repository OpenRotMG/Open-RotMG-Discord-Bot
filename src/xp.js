export const MAX_LEVEL = 99;
export const XP_PER_MESSAGE = 10;
export const COOLDOWN_MS = 5000;

export function xpForLevel(level) {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
    throw new Error('Level must be an integer from 1 to 99');
  }
  let points = 0;
  for (let n = 1; n < level; n++) points += Math.floor(n + 300 * 2 ** (n / 7));
  return Math.floor(points / 4);
}

const thresholds = Array.from({length: MAX_LEVEL}, (_, i) => xpForLevel(i + 1));

export function levelForXp(xp) {
  if (!Number.isSafeInteger(xp) || xp < 0) throw new Error('XP must be a nonnegative safe integer');
  return thresholds.findLastIndex(threshold => threshold <= xp) + 1;
}
