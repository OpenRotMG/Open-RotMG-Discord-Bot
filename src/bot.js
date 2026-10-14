import { buildLevel, jumpModal } from './levels.js';
import { ACCOUNT_STUBS, COMMANDS, formatUptime } from './commands.js';

export async function handleMessage(message, {store, guildId, now = Date.now}) {
  if (message.guildId !== guildId || message.author.bot || message.webhookId) return;
  const result = store.award(message, now());
  if (result?.leveledUp) {
    await message.channel.send({
      content: `Congratulations <@${message.author.id}>! You're now Level ${result.level}! 🎉`,
      allowedMentions: {parse: [], users: [message.author.id]},
    });
  }
}

export async function replyInteractionError(interaction) {
  const payload = {content: 'Could not complete this command. The error has been logged.'};
  if (!interaction.isRepliable()) return;
  if (interaction.deferred) await interaction.editReply(payload);
  else if (!interaction.replied) await interaction.reply({...payload, flags: 64});
}

export async function handleInteraction(interaction, {store, guildId, gameStatus, linkGame}) {
  if (interaction.guildId !== guildId) {
    await interaction.reply({content: 'This bot is configured for the Open RotMG server only.', flags: 64});
    return;
  }
  const userId = interaction.user.id;
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'help') {
      await interaction.reply({content: COMMANDS.map(command => `**/${command.name}**: ${command.description}`).join('\n'), flags: 64});
    } else if (interaction.commandName === 'level') {
      await interaction.reply({...buildLevel(store, guildId, userId), flags: 64});
    } else if (interaction.commandName === 'link') {
      if (!linkGame) throw new Error('Game linking API is not configured');
      const code = interaction.options.getString('code');
      if (!code) {
        await interaction.reply({content: 'Sign into your registered game account and type /discord in game. Then use /link code:<your private code> within five minutes. Linking shows your Discord identity on hiscores. Never send a password here.', flags: 64});
        return;
      }
      await interaction.deferReply({flags: 64});
      try {
        const result = await linkGame(code, userId);
        await interaction.editReply({content: `Linked to **${result.name}**. Your Discord identity will appear on the game hiscores.`, allowedMentions: {parse: []}});
      } catch (error) { await interaction.editReply({content: `Link could not be confirmed: ${error.message}. Use /discord in game to check whether this account is already linked.`, allowedMentions: {parse: []}}); }
    } else if (Object.hasOwn(ACCOUNT_STUBS, interaction.commandName)) {
      await interaction.reply({content: ACCOUNT_STUBS[interaction.commandName], flags: 64});
    } else if (['uptime', 'players'].includes(interaction.commandName)) {
      await interaction.deferReply({flags: 64});
      const status = await gameStatus();
      const content = !status.online ? 'Game server: down.' : interaction.commandName === 'uptime'
        ? `Game server uptime: **${formatUptime(status.uptimeSeconds)}**`
        : `${status.players} player${status.players === 1 ? '' : 's'}, ${status.bots} bot${status.bots === 1 ? '' : 's'}`;
      await interaction.editReply({content});
    } else {
      throw new Error(`Unknown command /${interaction.commandName}`);
    }
  } else if (interaction.isButton() && /^lvl:jump:\d+$/.test(interaction.customId)) {
    await interaction.showModal(jumpModal(Number(interaction.customId.split(':')[2])));
  } else if (interaction.isButton() && /^lvl:\d+$/.test(interaction.customId)) {
    await interaction.update({components: [], ...buildLevel(store, guildId, userId, Number(interaction.customId.split(':')[1]))});
  } else if (interaction.isModalSubmit() && interaction.customId === 'lvl:go') {
    const text = interaction.fields.getTextInputValue('page').trim();
    if (!/^[1-9]\d{0,3}$/.test(text)) {
      await interaction.reply({content: 'Enter a whole page number greater than zero.', flags: 64});
      return;
    }
    const card = {components: [], ...buildLevel(store, guildId, userId, Number(text) - 1)};
    if (interaction.isFromMessage()) await interaction.update(card);
    else await interaction.reply({...card, flags: 64});
  }
}
