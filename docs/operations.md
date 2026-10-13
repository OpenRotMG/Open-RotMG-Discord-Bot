# Bot setup and hosting

Use your own Discord application and test server, not the production bot identity.

1. Install Node 22.13–22.x.
2. Create a Discord application and install its bot in your test server with `bot` and `applications.commands` scopes. Grant View Channels, Send Messages, Send Messages in Threads and Embed Links where chat levels should operate. In `#announcements` and `#update-blog`, also grant Add Reactions and Read Message History; reactions do not require Send Messages.
3. Save the bot token in a private file outside this repository; restrict it to your user (mode 600 on Unix).
4. Copy `scripts/bot.env.example` to `.env`. Set your application/server IDs, the absolute token-file path and the absolute SQLite database path. Never commit either the token or `.env`.
5. Run `./run.sh`. It installs dependencies without generating a lockfile and starts the bot. It registers commands in the configured server.

Run tests with `npm install --package-lock=false && npm test`. To start on Windows, run `npm install --package-lock=false`, then `node --env-file=.env src/index.js`.

## Commands and game status

`/help` lists commands, `/level` shows your level and leaderboard, `/uptime` shows game server uptime, and `/players` separates online players from game bots. Replies are private.

`/link`, `/kick` and `/recover` are unavailable stubs pending registered-account authentication and linking. They do not link, disconnect or change any account. `/kick` is reserved for disconnecting your own linked account, not moderation.

Game status uses read-only HTTP GET. The endpoint must return nonnegative integer `uptime_seconds`, `players` (humans) and `bots`. Unreachable, timed-out or failing servers display “down”; malformed responses and configuration errors are logged explicitly, not turned into zero counts.

## Post reactions

Set `ANNOUNCEMENTS_CHANNEL_ID`, `UPDATE_BLOG_CHANNEL_ID` and `AMULET_EMOJI_ID` to your server's channels and custom emoji. Startup checks both channel names, server ownership and emoji availability. Every new message in those two channels gets the amulet reaction, including bot and webhook posts; other channels and threads are untouched. No Message Content or reaction gateway intent is required. Reaction failures are logged independently of XP failures.

To backfill existing posts once, use the same environment and token file:

```sh
node --env-file=.env scripts/backfill-reactions.js
```

It paginates all history, obeys Discord rate limits, skips posts already reacted to by this bot and does not touch XP or message text. Errors stop the run with channel/message progress logged; rerunning is safe. Backfill does not run on every startup.

## Hosting

The systemd unit runs on the game VM as a separate user with a 256 MiB memory limit. Install the repository at `/opt/openrotmg-discord-bot`, run `npm install --omit=dev --package-lock=false`, and put the bot token in `/etc/openrotmg-discord-bot/token` (root-owned, mode 600). Use `scripts/deploy/openrotmg-discord-bot.service`. Inspect logs with `journalctl -u openrotmg-discord-bot`.
