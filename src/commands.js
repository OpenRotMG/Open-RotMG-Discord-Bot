export const COMMANDS = [
  {name: 'help', description: 'Show all available commands', type: 1},
  {name: 'level', description: 'View your level, XP, and the server leaderboard', type: 1},
  {name: 'uptime', description: 'Show game server uptime or whether it is down', type: 1},
  {name: 'players', description: 'Show online players and game bots', type: 1},
  {name: 'link', description: 'Link your game account in your browser', type: 1},
  {name: 'unlink', description: 'Unlink your game account and disable Discord password recovery', type: 1},
  {name: 'announce', description: 'Announce a message to everyone online in the game', type: 1, options: [{name: 'text', description: 'Message shown in game, up to 200 characters', type: 3, required: true, max_length: 200}]},
  {name: 'gold', description: 'Give gold to a Discord user’s linked game account (Administrator only)', type: 1, default_member_permissions: '8', options: [{name: 'user', description: 'Discord user whose linked game account receives the gold', type: 6, required: true}, {name: 'amount', description: 'Gold to add', type: 4, required: true, min_value: 1, max_value: 2147483647}]},
  {name: 'kick', description: 'Save and disconnect your own linked game account', type: 1},
  {name: 'recover', description: 'Privately reset your linked game account password', type: 1, options: [{name: 'code', description: 'Legacy code from /discord recovery in game', type: 3, required: false, min_length: 32, max_length: 32}]},
];

export function formatUptime(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error('Invalid server uptime');
  return `${Math.floor(seconds / 86400)}d ${Math.floor(seconds / 3600) % 24}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`;
}
