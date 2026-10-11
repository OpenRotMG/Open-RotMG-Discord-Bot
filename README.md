# Open RotMG Discord Bot

Chat levels and `/level` for the Open RotMG Discord server. Uses Ziva's 10 XP per message, five-second cooldown, OSRS level curve (1–99), level-up message and private paginated leaderboard.

## Run

Requires Node.js 22.13 or newer.

```sh
npm ci
npm test
DISCORD_GUILD_ID=1558662335076376578 \
DISCORD_BOT_TOKEN_FILE=/secure/path/token \
DATABASE_PATH=/absolute/path/levels.sqlite npm start
```

Create a separate Discord application and install its bot in the Open RotMG server with `bot` and `applications.commands` scopes. Grant View Channels, Send Messages, Send Messages in Threads and Embed Links in the channels where it should operate. No Administrator, Message Content or Server Members intent is needed. `/level` is registered for the configured server at startup.

XP and the cooldown persist in SQLite. Bot messages, webhooks, DMs and other servers are ignored. No message text is read or stored. Ties share a rank; each leaderboard page has ten users, with navigation and page jump.

## Hosting

The systemd unit runs on the game VM as a separate user with a 256 MiB memory limit. Install the repository at `/opt/openrotmg-discord-bot`, run `npm ci --omit=dev`, and put the bot token in `/etc/openrotmg-discord-bot/token` (root-owned, mode 600). Use `deploy/openrotmg-discord-bot.service`. Inspect logs with `journalctl -u openrotmg-discord-bot`.

The bot has its own state directory. It currently has no access to game state, credentials or control commands. Future game read/write features belong behind an explicit game API, not direct access to the game database.

GPL-3.0-or-later. XP and leaderboard behavior are based on Ziva; no Ziva credentials, accounts, subscription logic or data are included.
