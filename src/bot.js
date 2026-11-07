import { PermissionFlagsBits } from 'discord.js';
import { buildLevel, jumpModal } from './levels.js';
import { COMMANDS, formatUptime } from './commands.js';
import { BUG_REPLY } from './bugs.js';
import {followLink} from './link.js';
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

export async function handleInteraction(interaction, {store, guildId, gameStatus, linkGame, linkStatus, unlinkGame, kickGame, recoverGame, goldGame, realmCloseGame, closeRealmGame, announceRoleId, announceGame, cancelRestartGame}) {
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
      if (!linkGame || !linkStatus) throw new Error('Game linking API is not configured');
      await interaction.deferReply({flags: 64});
      try {
        const result = await linkGame(userId);
        const url = new URL(result.url);
        if (url.origin !== 'https://openrotmg.org' || url.pathname !== '/link/' || url.search || !/^#[a-f0-9]{64}$/.test(url.hash) || url.username || url.password) throw new Error('Invalid linking response');
        await interaction.editReply({content: 'Link your OpenRotMG account', components: [{type: 1, components: [{type: 2, style: 5, label: 'Link game account', url: url.href}]}], allowedMentions: {parse: []}});
        await followLink(interaction, url.hash.slice(1), linkStatus);
      } catch (error) { await interaction.editReply({content: `Link could not be confirmed: ${error.message}. Run /link again.`, components: [], allowedMentions: {parse: []}}); }
    } else if (interaction.commandName === 'unlink') {
      if (!unlinkGame) throw new Error('Game unlinking API is not configured');
      await interaction.deferReply({flags: 64});
      try {
        const result = await unlinkGame(userId);
        if (typeof result.unlinked !== 'boolean') throw new Error('Invalid unlink response');
        await interaction.editReply({content: result.unlinked ? 'Account unlinked. Discord password recovery is disabled and outstanding recovery links are revoked. Your game password has not changed.' : 'No game account is linked to your Discord. Any pending link has been cancelled.', allowedMentions: {parse: []}});
      } catch (error) { await interaction.editReply({content: `Unlink could not be confirmed: ${error.message}`, allowedMentions: {parse: []}}); }
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
    } else if (interaction.commandName === 'give-gold') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({content: 'Giving gold requires Administrator permission.', flags: 64});
        return;
      }
      if (!goldGame) throw new Error('Gold API is not configured');
      const target = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 2147483647) {
        await interaction.reply({content: 'Gold amount must be a whole number from 1 to 2147483647.', flags: 64});
        return;
      }
      await interaction.deferReply({flags: 64});
      try {
        const result = await goldGame(target.id, amount, interaction.id, userId);
        if (!Number.isSafeInteger(result.balance) || result.balance < amount || result.balance > 2147483647) throw new Error('Invalid gold response');
        await interaction.editReply({content: `Added ${amount} gold to <@${target.id}>'s linked game account. Balance: ${result.balance} gold.`, allowedMentions: {parse: []}});
      } catch (error) {
        await interaction.editReply({content: `Gold grant to <@${target.id}> could not be confirmed: ${error.message}. It may already have been credited; check the linked account's balance before issuing another /give-gold command.`, allowedMentions: {parse: []}});
        return;
      }
      try {
        await interaction.followUp({content: `<@${userId}> gave <@${target.id}> ${amount} gold! 🪙`, flags: 0, allowedMentions: {parse: [], users: [target.id]}});
      } catch (error) {
        await interaction.editReply({content: `The ${amount} gold was credited, but the public announcement could not be confirmed: ${error.message}. Do not repeat /give-gold for this grant.`, allowedMentions: {parse: []}});
      }
    } else if (interaction.commandName === 'cancel-restart') {
      if (!interaction.member?.roles?.cache?.has(announceRoleId) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({content: 'Cancelling a restart requires the Moderator role or Administrator permission.', flags: 64});
        return;
      }
      if (!cancelRestartGame || !announceGame) throw new Error('Restart API is not configured');
      await interaction.deferReply({flags: 64});
      try {
        const result = await cancelRestartGame(userId);
        if (result?.state !== 'cancelled') throw new Error('Invalid restart response');
      } catch (error) {
        await interaction.editReply({content: `Restart cancellation could not be confirmed: ${error.message}`, allowedMentions: {parse: []}});
        return;
      }
      try {
        const notice = await announceGame('Server update restart cancelled. This countdown will not restart the server.');
        if (!Number.isSafeInteger(notice?.players) || notice.players < 0) throw new Error('Invalid announcement response');
      } catch (error) {
        await interaction.editReply({content: `Server update restart cancelled, but the in-game notice could not be confirmed: ${error.message}. This update will not be deployed.`, allowedMentions: {parse: []}});
        return;
      }
      await interaction.editReply({content: 'Server update restart cancelled. This update will not be deployed.', allowedMentions: {parse: []}});
    } else if (interaction.commandName === 'give-close-realm') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({content: 'Giving Realm Close tokens requires Administrator permission.', flags: 64});
        return;
      }
      if (!realmCloseGame) throw new Error('Realm Close API is not configured');
      const target = interaction.options.getUser('user', true);
      await interaction.deferReply({flags: 64});
      try {
        const result = await realmCloseGame(target.id, interaction.id, userId);
        if (!Number.isSafeInteger(result.tokens) || result.tokens < 1) throw new Error('Invalid Realm Close response');
        await interaction.editReply({content: `Gave <@${target.id}> a Realm Close token. They now have ${result.tokens}.`, allowedMentions: {parse: []}});
      } catch (error) {
        await interaction.editReply({content: `Could not give <@${target.id}> a Realm Close token: ${error.message}`, allowedMentions: {parse: []}});
        return;
      }
      try {
        await interaction.followUp({content: `<@${target.id}> - <@${userId}> gave you a Realm Close token! While in a realm, \`/close-realm\` on Discord to activate it.`, flags: 0, allowedMentions: {parse: [], users: [target.id]}});
      } catch (error) {
        await interaction.editReply({content: `The Realm Close token was given, but the public announcement could not be confirmed: ${error.message}. Do not repeat /give-close-realm for this grant.`, allowedMentions: {parse: []}});
      }
    } else if (interaction.commandName === 'close-realm') {
      if (!closeRealmGame) throw new Error('Realm Close API is not configured');
      await interaction.deferReply({flags: 64});
      try {
        const result = await closeRealmGame(userId, interaction.id);
        if (typeof result.name !== 'string' || !result.name) throw new Error('Invalid Realm Close response');
        await interaction.editReply({content: `Your Realm Close token was used. Oryx is closing ${result.name}'s Realm.`, allowedMentions: {parse: []}});
      } catch (error) {
        await interaction.editReply({content: `Realm was not closed: ${error.message}`, allowedMentions: {parse: []}});
        return;
      }
      await interaction.followUp({content: `<@${userId}> used a Realm Close token! Oryx is closing their Realm. 🏰`, flags: 0, allowedMentions: {parse: []}});
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
