import { json, readBody } from './status.js';
import { beginSession } from '../../domain/state.js';
export async function handleSession(request, env, repo, device) {
  const body = await readBody(request, 1024);
  if (!body || Object.keys(body).some(k => k !== 'requestId')) throw new Error('invalid_session');
  return json(await repo.mutate(s => beginSession(s, body.requestId, device, Date.now())));
}
