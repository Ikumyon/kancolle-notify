import { json, readBody } from './status.js';
import { receiveUpdate, validateUpdate } from '../../domain/reservations.js';
export async function handleTimers(request, env, repo, device) {
  const body = await readBody(request);
  if (!body || Object.keys(body).length !== 1 || !Array.isArray(body.updates) || !body.updates.length || body.updates.length > 25) throw new Error('invalid_batch');
  body.updates.forEach(validateUpdate);
  const { results, timers } = await repo.mutate(s => {
    let stopped;
    const res = body.updates.map(u => {
      const result = stopped ? { sequence: u.sequence, receivedAt: Date.now(), status: stopped } : receiveUpdate(s, u, device, Date.now());
      if (!['accepted', 'duplicate'].includes(result.status)) stopped = result.status;
      return result;
    });
    return { results: res, timers: structuredClone(s.timers) };
  });
  return json({ results, timers });
}
