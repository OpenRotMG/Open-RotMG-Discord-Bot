import { buildLevel, jumpModal } from './levels.js';

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

export async function handleInteraction(interaction, {store, guildId}) {
  if (interaction.guildId !== guildId) {
    await interaction.reply({content: 'This bot is configured for the Open RotMG server only.', flags: 64});
    return;
  }
  const userId = interaction.user.id;
  if (interaction.isChatInputCommand() && interaction.commandName === 'level') {
    await interaction.reply({...buildLevel(store, guildId, userId), flags: 64});
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
