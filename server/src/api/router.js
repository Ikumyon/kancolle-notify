import { authenticate } from './auth.js';
import { json } from './handlers/status.js';
import { handleStatus } from './handlers/status.js';
import { handleSession } from './handlers/session.js';
import { handleObservations } from './handlers/observations.js';
import { handleManual } from './handlers/manual.js';
import { handleGetSettings, handlePostSettings, handleResume } from './handlers/settings.js';
import { handleTelegramWebhook } from './handlers/chat-webhook.js';
import { Repository } from '../repository/repository.js';

export async function route(request, env) {
  const url = new URL(request.url);
  const repo = new Repository(env.DB);

  // 1. チャット Webhook（Telegram 送信元検証による認証）
  if (request.method === 'POST' && url.pathname === '/webhook/telegram') {
    return handleTelegramWebhook(request, env, repo);
  }

  // 2. クライアント API（デバイストークン認証）
  const device = await authenticate(request, env);
  if (!device) return json({ error: 'unauthorized' }, 401);

  if (request.method === 'GET' && url.pathname === '/v2/status') {
    return handleStatus(request, env, repo);
  }

  if (request.method === 'GET' && url.pathname === '/v2/notification-settings') {
    return handleGetSettings(request, env, repo);
  }

  if (request.method === 'POST' && url.pathname === '/v2/notification-settings') {
    return handlePostSettings(request, env, repo);
  }

  if (request.method === 'POST' && url.pathname === '/v2/session') {
    return handleSession(request, env, repo, device);
  }

  if (request.method === 'POST' && url.pathname === '/v2/observations') {
    return handleObservations(request, env, repo, device);
  }

  if (request.method === 'POST' && url.pathname === '/v2/resume') {
    return handleResume(request, env, repo);
  }

  if (request.method === 'POST' && url.pathname === '/v2/manual') {
    return handleManual(request, env, repo, device);
  }

  return json({ error: 'not_found' }, 404);
}
