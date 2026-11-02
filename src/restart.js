import {gameJson} from './hiscores.js';

export async function cancelRestart(origin, token, actor_id) {
  const url = `${origin}/internal/lifecycle/restart`;
  const pending = await gameJson(url, {body: {operation: 'status'}, token});
  const receipt = pending?.receipt;
  if (pending?.state !== 'pending' || !receipt || !['instance', 'owner'].every(k => typeof receipt[k] === 'string' && /^[a-f0-9]{64}$/.test(receipt[k])) || !Number.isSafeInteger(receipt.deadline_ms) || receipt.deadline_ms <= 0) throw new Error('Invalid pending restart response');
  const result = await gameJson(url, {body: {operation: 'cancel', receipt, actor_id}, token});
  if (result?.state !== 'cancelled' || !result.receipt || ['instance', 'owner', 'deadline_ms'].some(k => result.receipt[k] !== receipt[k])) throw new Error('Invalid restart cancellation response');
  return result;
}
