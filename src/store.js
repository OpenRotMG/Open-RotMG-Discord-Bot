import { DatabaseSync } from 'node:sqlite';
import { COOLDOWN_MS, XP_PER_MESSAGE, levelForXp } from './xp.js';

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS levels (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT NOT NULL,
      xp INTEGER NOT NULL CHECK (xp >= 0 AND xp <= 9007199254740991),
      last_xp_at INTEGER NOT NULL, last_message_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    ) STRICT;`);
  const get = db.prepare('SELECT * FROM levels WHERE guild_id=? AND user_id=?');
  const grant = db.prepare(`INSERT INTO levels (guild_id,user_id,username,xp,last_xp_at,last_message_id) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET username=excluded.username,
    xp=excluded.xp,last_xp_at=excluded.last_xp_at,last_message_id=excluded.last_message_id`);
  const ranked = `SELECT *, RANK() OVER (ORDER BY xp DESC) AS rank,
    ROW_NUMBER() OVER (ORDER BY xp DESC,user_id ASC) AS position,
    COUNT(*) OVER () AS total FROM levels WHERE guild_id=?`;
  const me = db.prepare(`SELECT * FROM (${ranked}) WHERE user_id=?`);
  const page = db.prepare(`SELECT * FROM (${ranked}) ORDER BY position LIMIT 10 OFFSET ?`);
  return {
    award(message, now) {
      if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid award time');
      const id = BigInt(message.id);
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = get.get(message.guildId, message.author.id);
        if (previous && (id <= BigInt(previous.last_message_id) || now - previous.last_xp_at < COOLDOWN_MS)) {
          db.exec('COMMIT');
          return null;
        }
        const oldXp = previous ? previous.xp : 0;
        const xp = oldXp + XP_PER_MESSAGE;
        const oldLevel = levelForXp(oldXp);
        const level = levelForXp(xp);
        grant.run(message.guildId, message.author.id, message.author.username, xp, now, message.id);
        db.exec('COMMIT');
        return {xp, level, leveledUp: level > oldLevel};
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    me: (guildId, userId) => me.get(guildId, userId),
    page: (guildId, offset) => page.all(guildId, offset),
    close: () => db.close(),
  };
}
