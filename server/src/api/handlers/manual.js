import { json, snapshot } from './status.js';
import { manualReservation } from '../../domain/state.js';

export async function handleManual(request, env, repo, device) {
  const text = await request.text();
  if (text.length > 2048) return json({ error: 'invalid_manual' }, 400);

  let command;
  try {
    command = JSON.parse(text);
  } catch {
    return json({ error: 'invalid_manual' }, 400);
  }

  try {
    const now = Date.now();
    const result = await repo.mutate(s => manualReservation(s, command, device, now));
    return json({ now, ...result, state: await snapshot(repo) });
  } catch (e) {
    if (['invalid_manual', 'manual_limit', 'manual_not_found'].includes(e.message)) {
      return json({ error: e.message }, 400);
    }
    throw e;
  }
}
