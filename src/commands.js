export const COMMANDS = [
  {name: 'help', description: 'Show all available commands', type: 1},
  {name: 'level', description: 'View your level, XP, and the server leaderboard', type: 1},
  {name: 'uptime', description: 'Show game server uptime or whether it is down', type: 1},
  {name: 'players', description: 'Show online players and game bots', type: 1},
  {name: 'link', description: 'Link your registered game account using its private /discord code', type: 1, options: [{name: 'code', description: 'One-use code from /discord in game', type: 3, required: false, min_length: 32, max_length: 32}]},
  {name: 'kick', description: 'Disconnect your own linked game account (not available yet)', type: 1},
  {name: 'recover', description: 'Reset your linked game password (not available yet)', type: 1},
];

export const ACCOUNT_STUBS = {
  kick: "Account disconnection isn't implemented yet. This command will only disconnect your own linked account once linking is available. This command has not disconnected any account.",
  recover: "Password recovery isn't implemented yet. This command has not changed any password.",
};

export function formatUptime(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error('Invalid server uptime');
  return `${Math.floor(seconds / 86400)}d ${Math.floor(seconds / 3600) % 24}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`;
}
