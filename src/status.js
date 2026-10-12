export function statusUrl(value) {
  if (!value) throw new Error('GAME_STATUS_URL is required');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('GAME_STATUS_URL must be an HTTP(S) endpoint without credentials, query or fragment');
  }
  return url.href;
}

export async function readGameStatus(url, request = fetch) {
  let response;
  let data;
  const signal = AbortSignal.timeout(2000);
  try {
    response = await request(url, {signal, redirect: 'error', headers: {accept: 'application/json'}});
    if (response.status >= 500) return {online: false, reason: {status: response.status}};
    if (!response.ok) throw new Error(`Game status endpoint returned HTTP ${response.status}`);
    data = await response.json();
  } catch (error) {
    if (signal.aborted || error.name === 'TimeoutError' || (error instanceof TypeError && typeof error.cause?.code === 'string')) {
      return {online: false, reason: {name: signal.aborted ? 'TimeoutError' : error.name, code: error.cause?.code, message: error.message}};
    }
    throw error;
  }
  for (const key of ['uptime_seconds', 'players', 'bots']) {
    if (!Number.isSafeInteger(data?.[key]) || data[key] < 0) throw new Error(`Game status has invalid ${key}`);
  }
  return {online: true, uptimeSeconds: data.uptime_seconds, players: data.players, bots: data.bots};
}
