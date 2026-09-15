import { NotificationScheduler } from './scheduler/scheduler.js';
import { route } from './api/router.js';
import { authenticate } from './api/auth.js';
import { json } from './api/handlers/status.js';
import { dispatch } from './notify/dispatcher.js';

export { NotificationScheduler, dispatch, route as handle };

export default {
  async fetch(request, env) {
    try {
      // ローカル疑似環境等で SCHEDULER がない場合のフォールバック
      if (!env.SCHEDULER) {
        return await route(request, env);
      }

      const url = new URL(request.url);

      // Webhook の場合は個別の認証（Telegram検証等）をルーター内で行うためDOへそのまま転送
      if (url.pathname.startsWith('/webhook/')) {
        return await env.SCHEDULER.get(env.SCHEDULER.idFromName('owner')).fetch(request);
      }

      // クライアントAPIはデバイストークン認証を事前チェック
      if (!await authenticate(request, env)) {
        return json({ error: 'unauthorized' }, 401);
      }

      // 認証済みの変更と配信を同じDurable Objectで順番に処理
      return await env.SCHEDULER.get(env.SCHEDULER.idFromName('owner')).fetch(request);
    } catch (e) {
      console.error('server_error', e);
      return json({ error: 'server_error' }, 503);
    }
  }
};
