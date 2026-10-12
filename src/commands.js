export const COMMANDS = [
  {name: 'help', description: 'Show all available commands', type: 1},
  {name: 'level', description: 'View your level, XP, and the server leaderboard', type: 1},
  {name: 'uptime', description: 'Show game server uptime or whether it is down', type: 1},
  {name: 'players', description: 'Show online players and game bots', type: 1},
];

export function formatUptime(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error('Invalid server uptime');
  return `${Math.floor(seconds / 86400)}d ${Math.floor(seconds / 3600) % 24}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`;
}
