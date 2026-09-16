import { json, readBody } from './status.js';
import { createManual, cancelManual, validId } from '../../domain/state.js';
export async function handleManual(request, env, repo, id) {
  if (request.method === 'GET') return json({ reservations: Object.values((await repo.read()).state.timers).filter(t => t.kind === 'manual') });
  if (request.method === 'POST') {
    const command = await readBody(request, 2048);
    return json({ reservation: await repo.mutate(s => createManual(s, command, Date.now())) });
  }
  if (!validId(id)) throw new Error('invalid_manual');
  return json({ reservation: await repo.mutate(s => cancelManual(s, id, Date.now())) });
}
