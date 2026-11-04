import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { handleInteraction } from '../src/bot.js';

const guildId = '1558662335076376578';
const target = '1558662335076376579';
const actor = '1558662335076376580';
const request = '1558662335076376581';
function command(commandName, extra = {}) {
  const replies = [], announcements = [];
  return {replies, announcements, interaction: {guildId, user: {id: actor}, id: request, commandName,
    isChatInputCommand: () => true,
    memberPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
    options: {getUser: () => ({id: target})},
    reply: async p => replies.push(p),
    deferReply: async p => assert.deepEqual(p, {flags: 64}),
    editReply: async p => replies.push(p),
    followUp: async p => announcements.push(p),
    ...extra}};
}

test('/give-close-realm is Administrator-only and announces the token to the recipient', async () => {
  const denied = command('give-close-realm', {memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild)});
  await handleInteraction(denied.interaction, {guildId, realmCloseGame: () => assert.fail('Unauthorized API call')});
  assert.match(denied.replies[0].content, /Administrator/);
  const calls = [];
  const given = command('give-close-realm');
  await handleInteraction(given.interaction, {guildId, realmCloseGame: async (...args) => {calls.push(args); return {tokens: 2};}});
  assert.deepEqual(calls, [[target, request, actor]]);
  assert.match(given.replies[0].content, /They now have 2/);
  assert.deepEqual(given.announcements, [{content: `<@${target}> <@${actor}> gave you a Realm Close token! While in a realm, \`/close-realm\` on Discord to activate it.`, flags: 0, allowedMentions: {parse: [], users: [target]}}]);
});

test('/close-realm announces a started closure and reports refusals privately without announcing', async () => {
  const used = command('close-realm');
  await handleInteraction(used.interaction, {guildId, closeRealmGame: async (...args) => {assert.deepEqual(args, [actor, request]); return {name: 'Hero'};}});
  assert.match(used.replies[0].content, /Oryx is closing Hero's Realm/);
  assert.equal(used.announcements[0].content, `<@${actor}> used a Realm Close token! Oryx is closing their Realm. 🏰`);
  const refused = command('close-realm');
  await handleInteraction(refused.interaction, {guildId, closeRealmGame: async () => {throw new Error('You have no Realm Close tokens.');}});
  assert.equal(refused.replies[0].content, 'Realm was not closed: You have no Realm Close tokens.');
  assert.deepEqual(refused.announcements, []);
});
