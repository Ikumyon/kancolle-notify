import { publicTimer } from '../../domain/timer.js';
export { publicTimer } from '../../domain/timer.js';
export const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function readBody(request, limit = 2097152) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_json');
  const chunks = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); throw new Error('too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('invalid_json'); }
}
export async function snapshot(repo, now = Date.now()) {
  const { revision, state } = await repo.read();
  return { revision, now, settings: state.settings,
    timers: Object.values(state.timers).map(t => publicTimer(t, state.settings, now)),
    deliveries: Object.values(state.deliveries).map(({ item, token, ...d }) => ({ ...d, item: publicTimer(item, state.settings, now) })),
    history: await repo.history(now) };
}
export async function handleStatus(request, env, repo) { return json(await snapshot(repo)); }
