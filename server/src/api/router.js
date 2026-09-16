import { authenticate } from './auth.js';
import { json, handleStatus } from './handlers/status.js';
import { handleSession } from './handlers/session.js';
import { handleTimers } from './handlers/timers.js';
import { handleManual } from './handlers/manual.js';
import { handleGetSettings, handlePatchSettings } from './handlers/settings.js';
import { handleTelegramWebhook } from './handlers/chat-webhook.js';
import { Repository } from '../repository/repository.js';
export async function route(request, env) {
  const path = new URL(request.url).pathname, method = request.method, repo = new Repository(env.DB);
  try {
    if (path === '/webhook/telegram' && method === 'POST') return await handleTelegramWebhook(request, env, repo);
    const device = await authenticate(request, env);
    if (!device) return json({ error: 'unauthorized' }, 401);
    if (path === '/api/status' && method === 'GET') return await handleStatus(request, env, repo);
    if (path === '/api/session' && method === 'POST') return await handleSession(request, env, repo, device);
    if (path === '/api/timers' && method === 'POST') return await handleTimers(request, env, repo, device);
    if (path === '/api/settings' && method === 'GET') return await handleGetSettings(request, env, repo);
    if (path === '/api/settings' && method === 'PATCH') return await handlePatchSettings(request, env, repo);
    if (path === '/api/manual' && ['GET', 'POST'].includes(method)) return await handleManual(request, env, repo);
    const match = path.match(/^\/api\/manual\/([A-Za-z0-9_-]+)$/);
    if (match && method === 'DELETE') return await handleManual(request, env, repo, match[1]);
    return json({ error: 'not_found' }, 404);
  } catch (e) {
    if (e.message === 'too_large') return json({ error: e.message }, 413);
    if (e.message.startsWith('invalid_') || e.message === 'manual_limit') return json({ error: e.message }, 400);
    if (e.message === 'manual_not_found') return json({ error: e.message }, 404);
    throw e;
  }
}
