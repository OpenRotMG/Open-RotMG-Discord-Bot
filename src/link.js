import {setTimeout as delay} from 'node:timers/promises';

export async function followLink(interaction, token, status, {wait = delay, now = Date.now} = {}) {
  const deadline = now() + 300000;
  while (now() < deadline) {
    const result = await status(token);
    if (result.state === 'linked') {
      await interaction.editReply({content: 'Account linked!', components: [], allowedMentions: {parse: []}});
      return;
    }
    if (result.state === 'expired') break;
    if (result.state !== 'pending') throw new Error('Invalid link status response');
    await wait(Math.min(5000, Math.max(0, deadline - now())));
  }
  await interaction.editReply({content: 'Link expired. Run /link again.', components: [], allowedMentions: {parse: []}});
}
