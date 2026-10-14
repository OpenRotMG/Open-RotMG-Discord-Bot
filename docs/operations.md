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

`/link` explains how to type `/discord` while signed into a registered game account, then privately redeems the five-minute one-use code. Replies are ephemeral and bind only the actual interaction user ID. No game password is requested. Conflicts never replace links. `/kick` and `/recover` remain unavailable; `/kick` is reserved for disconnecting your own account, not moderation.

Game status uses read-only HTTP GET. The endpoint must return nonnegative integer `uptime_seconds`, `players` (humans) and `bots`. Unreachable, timed-out or failing servers display “down”; malformed responses and configuration errors are logged explicitly, not turned into zero counts.

## Permanent game hiscores

Set `HISCORES_CATEGORY_ID` to the `Hiscores` category in your own test server and `GAME_API_URL` to the game server's explicit HTTP loopback origin. Set `DISCORD_LINK_TOKEN_FILE` to the same private credential file configured for the game server; it is separate from the Discord token. The API grants only code redemption, not gameplay/database/password access.

Run the explicit setup once:

```sh
node --env-file=.env scripts/setup-hiscores.js
```

It creates `#fame`, `#collection` and `#total-fame` under that category and one permanent bot-owned top-ten message in each. Creating channels requires Manage Channels; alternatively create those exact text channels yourself and grant the bot View Channel, Send Messages, Read Message History and Embed Links. No Administrator or privileged gateway intent is needed. Setup refuses duplicate names/managed messages. Routine startup never creates missing resources silently.

Messages update once a minute only when scores or identities change. Each links to the full website board. There is no `/hiscores`, pagination button or interaction UI. Ties share rank; mentions do not ping. Failures leave the previous message intact and log `hiscores_refresh_failed`, rather than publishing invented zeros. The game server's `docs/hiscores.md` defines the metrics, eligibility and collection provenance.

## Post reactions

Set `ANNOUNCEMENTS_CHANNEL_ID`, `UPDATE_BLOG_CHANNEL_ID` and `AMULET_EMOJI_ID` to your server's channels and custom emoji. Startup checks both channel names, server ownership and emoji availability. Every new message in those two channels gets the amulet reaction, including bot and webhook posts; other channels and threads are untouched. No Message Content or reaction gateway intent is required. Reaction failures are logged independently of XP failures.

To backfill existing posts once, use the same environment and token file:

```sh
node --env-file=.env scripts/backfill-reactions.js
```

It paginates all history, obeys Discord rate limits, skips posts already reacted to by this bot and does not touch XP or message text. Errors stop the run with channel/message progress logged; rerunning is safe. Backfill does not run on every startup.

## Hosting

The systemd unit runs on the game VM as a separate user with a 256 MiB memory limit. Install the repository at `/opt/openrotmg-discord-bot`, run `npm install --omit=dev --package-lock=false`, and put the bot token in `/etc/openrotmg-discord-bot/token` (root-owned, mode 600). Install a separately generated root-owned mode-600 link API credential at `/etc/openrotmg/discord-link-token`, shared with the game service only through systemd `LoadCredential`. Use `scripts/deploy/openrotmg-discord-bot.service`. Inspect logs with `journalctl -u openrotmg-discord-bot`.
