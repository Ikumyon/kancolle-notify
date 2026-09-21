import { NotificationScheduler } from './scheduler/scheduler.js';
import { authenticate } from './api/auth.js';
import { json, CORS_HEADERS } from './api/handlers/status.js';
export { NotificationScheduler };
export { dispatch } from './notify/dispatcher.js';
export default {
  async fetch(request, env) {
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
      if (new URL(request.url).pathname !== '/webhook/telegram' && !await authenticate(request, env)) return json({ error: 'unauthorized' }, 401);
      if (!env.SCHEDULER) return json({ error: 'scheduler_unavailable' }, 503);
      return await env.SCHEDULER.get(env.SCHEDULER.idFromName('owner')).fetch(request);
    } catch { return json({ error: 'server_error' }, 503); }
  }
};
