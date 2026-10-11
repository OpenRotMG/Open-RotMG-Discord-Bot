<h1><img src="readme-icon.png" width="44" height="44" align="absmiddle" alt=""> Open RotMG / Discord Bot</h1>

Chat levels and leaderboards for the Open RotMG Discord server. Earn XP by chatting, and use `/level` to see your level and the leaderboard.

## Run

```sh
npm ci
npm test
DISCORD_APPLICATION_ID=1558885888400818247 \
DISCORD_GUILD_ID=1558662335076376578 \
DISCORD_BOT_TOKEN_FILE=/secure/path/token \
DATABASE_PATH=/absolute/path/levels.sqlite npm start
```

Create a separate Discord application and install its bot in the Open RotMG server with `bot` and `applications.commands` scopes. Grant View Channels, Send Messages, Send Messages in Threads and Embed Links in the channels where it should operate.

## Hosting

The systemd unit runs on the game VM as a separate user with a 256 MiB memory limit. Install the repository at `/opt/openrotmg-discord-bot`, run `npm ci --omit=dev`, and put the bot token in `/etc/openrotmg-discord-bot/token` (root-owned, mode 600). Use `deploy/openrotmg-discord-bot.service`. Inspect logs with `journalctl -u openrotmg-discord-bot`..
