<h1><img src="readme-icon.png" width="44" height="44" align="absmiddle" alt=""> Open RotMG / Discord Bot</h1>

Chat levels and game status for the Open RotMG Discord server. `/help` lists commands, `/level` shows your level and leaderboard, `/uptime` shows game server uptime, and `/players` separates online players from game bots. Replies are private.

## Run

```sh
npm ci
npm test
DISCORD_APPLICATION_ID=1558885888400818247 \
DISCORD_GUILD_ID=1558662335076376578 \
GAME_STATUS_URL=https://openrotmg.org/health \
DISCORD_BOT_TOKEN_FILE=/secure/path/token \
DATABASE_PATH=/absolute/path/levels.sqlite npm start
```

Create a separate Discord application and install its bot in the Open RotMG server with `bot` and `applications.commands` scopes. Grant View Channels, Send Messages, Send Messages in Threads and Embed Links in the channels where it should operate.

Game status uses read-only HTTP GET. The endpoint must return nonnegative integer `uptime_seconds`, `players` (humans) and `bots`. Unreachable, timed-out or failing servers display “down”; malformed responses and configuration errors are logged explicitly, not turned into zero counts.

## Hosting

The systemd unit runs on the game VM as a separate user with a 256 MiB memory limit. Install the repository at `/opt/openrotmg-discord-bot`, run `npm ci --omit=dev`, and put the bot token in `/etc/openrotmg-discord-bot/token` (root-owned, mode 600). Use `deploy/openrotmg-discord-bot.service`. Inspect logs with `journalctl -u openrotmg-discord-bot`..
