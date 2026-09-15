import { json, snapshot } from './status.js';
import { beginSession } from '../../domain/generation.js';

export async function handleSession(request, env, repo, device) {
  const text = await request.text();
  if (text.length > 512) return json({ error: 'invalid_session' }, 400);

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'invalid_session' }, 400);
  }

  try {
    const ticket = await repo.mutate(s => beginSession(s, body.session, device, Date.now()));
    return json({ ticket, state: await snapshot(repo) });
  } catch (e) {
    if (e.message === 'invalid_session') return json({ error: e.message }, 400);
    throw e;
  }
}
