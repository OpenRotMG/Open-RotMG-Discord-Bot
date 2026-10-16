export const COMMANDS = [
  {name: 'help', description: 'Show all available commands', type: 1},
  {name: 'level', description: 'View your level, XP, and the server leaderboard', type: 1},
  {name: 'uptime', description: 'Show game server uptime or whether it is down', type: 1},
  {name: 'players', description: 'Show online players and game bots', type: 1},
  {name: 'link', description: 'Link your registered game account using its private /discord code', type: 1, options: [{name: 'code', description: 'One-use code from /discord in game', type: 3, required: false, min_length: 32, max_length: 32}]},
  {name: 'announce', description: 'Announce a message to everyone online in the game', type: 1, options: [{name: 'text', description: 'Message shown in game, up to 200 characters', type: 3, required: true, max_length: 200}]},
  {name: 'kick', description: 'Save and disconnect your own linked game account', type: 1},
  {name: 'recover', description: 'Privately reset your game password after opting in from the game', type: 1, options: [{name: 'code', description: 'Consent code from /discord recovery in game (first use only)', type: 3, required: false, min_length: 32, max_length: 32}]},
];

export function formatUptime(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error('Invalid server uptime');
  return `${Math.floor(seconds / 86400)}d ${Math.floor(seconds / 3600) % 24}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`;
}
