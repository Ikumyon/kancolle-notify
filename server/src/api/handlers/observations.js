import { json, snapshot } from './status.js';
import { observe } from '../../domain/state.js';

export async function handleObservations(request, env, repo, device) {
  if (Number(request.headers.get('Content-Length')) > 131072) {
    return json({ error: 'too_large' }, 413);
  }
  const text = await request.text();
  if (text.length > 131072) return json({ error: 'too_large' }, 413);

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (!Array.isArray(body.observations) || body.observations.length < 1 || body.observations.length > 25) {
    return json({ error: 'invalid_batch' }, 400);
  }

  try {
    const now = Date.now();
    const results = await repo.mutate(s => body.observations.map(o => observe(s, o, device, now)));
    return json({ now, results, state: await snapshot(repo) });
  } catch (e) {
    if (e.message === 'invalid_observation') return json({ error: e.message }, 400);
    throw e;
  }
}
