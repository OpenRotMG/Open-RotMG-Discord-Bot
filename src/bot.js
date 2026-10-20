import { buildLevel, jumpModal } from './levels.js';
import { COMMANDS, formatUptime } from './commands.js';
import { BUG_REPLY } from './bugs.js';
const bugReplies = new Map();

export async function handleMessage(message, {store, guildId, now = Date.now}) {
  if (message.guildId !== guildId || message.author.bot || message.webhookId) return;
  if (message.content?.trim() === '!bug') {
    const time = now();
    for (const [id, at] of bugReplies) if (time - at >= 30000) bugReplies.delete(id);
    if (bugReplies.has(message.author.id) || bugReplies.size >= 4096) return;
    bugReplies.set(message.author.id, time);
    try { await message.reply({content: BUG_REPLY, allowedMentions: {parse: [], repliedUser: false}}); }
    catch (error) { bugReplies.delete(message.author.id); throw error; }
    return;
  }
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

export async function handleInteraction(interaction, {store, guildId, gameStatus, linkGame, kickGame, recoverGame, announceRoleId, announceGame}) {
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
      await interaction.deferReply({flags: 64});
      try {
        const result = await linkGame(userId);
        const url = new URL(result.url);
        if (url.origin !== 'https://openrotmg.org' || url.pathname !== '/link/' || url.search || !/^#[a-f0-9]{64}$/.test(url.hash) || url.username || url.password) throw new Error('Invalid linking response');
        await interaction.editReply({content: 'Link your OpenRotMG account', components: [{type: 1, components: [{type: 2, style: 5, label: 'Link game account', url: url.href}]}], allowedMentions: {parse: []}});
      } catch (error) { await interaction.editReply({content: `Link could not be started: ${error.message}`, allowedMentions: {parse: []}}); }
    } else if (['kick', 'recover'].includes(interaction.commandName)) {
      const kick = interaction.commandName === 'kick';
      if (kick ? !kickGame : !recoverGame) throw new Error('Game account API is not configured');
      await interaction.deferReply({flags: 64});
      try {
        if (kick) {
          const result = await kickGame(userId);
          if (typeof result.disconnected !== 'boolean') throw new Error('Invalid disconnect response');
          await interaction.editReply({content: result.disconnected ? 'Your linked game connection was disconnected after its state was saved.' : 'Your linked game account has no active connection.', allowedMentions: {parse: []}});
        } else {
          const result = await recoverGame(interaction.options.getString('code'), userId);
          const url = new URL(result.url);
          if (url.origin !== 'https://openrotmg.org' || url.pathname !== '/recover/' || url.search || !/^#[a-f0-9]{64}$/.test(url.hash) || url.username || url.password) throw new Error('Invalid reset response');
          await interaction.editReply({content: `Reset your game password here within 15 minutes:\n${url.href}\nKeep this one-use link private. Requesting it does not change your password; completing it saves and disconnects any active game session. Discord recovery is now enabled. To revoke it, type /discord norecovery in game.`, flags: 4, allowedMentions: {parse: []}});
        }
      } catch (error) {
        await interaction.editReply({content: `${kick ? 'Disconnect' : 'Recovery'} could not be confirmed: ${error.message}`, allowedMentions: {parse: []}});
      }
    } else if (interaction.commandName === 'announce') {
      if (!interaction.member?.roles?.cache?.has(announceRoleId)) {
        await interaction.reply({content: 'Announcing requires the Moderator role.', flags: 64});
        return;
      }
      if (!announceGame) throw new Error('Announcement API is not configured');
      await interaction.deferReply({flags: 64});
      try {
        const result = await announceGame(interaction.options.getString('text'));
        if (!Number.isSafeInteger(result.players)) throw new Error('Invalid announcement response');
        await interaction.editReply({content: `Announced to ${result.players} online player${result.players === 1 ? '' : 's'}.`, allowedMentions: {parse: []}});
      } catch (error) {
        await interaction.editReply({content: `Announcement was not delivered: ${error.message}`, allowedMentions: {parse: []}});
      }
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
