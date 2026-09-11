import { beginSession } from '../extension/core/generation.js';
import { Repository } from './repository.js';
import { observe, claimDelivery, finishDelivery, formatDelivery, prune, manualReservation } from '../extension/core/state.js';
async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
}
async function authenticate(request, env) {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/)?.[1];
  if (!token) return null;
  let devices;
  try { devices = JSON.parse(env.DEVICE_TOKENS || '{}'); } catch { return null; }
  const digest = await hash(token);
  return Object.entries(devices).find(([id, h]) => /^[A-Za-z0-9_-]{1,80}$/.test(id) && h === digest)?.[0] || null;
}
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
async function snapshot(repo) {
  const { state } = await repo.read();
  return { now: Date.now(), slots: state.slots, history: await repo.history(),
    pendingDelivery: state.delivery ? { attempt: state.delivery.attempt, nextTry: state.delivery.nextTry } : null,
    authBlocked: state.authBlocked };
}
export async function handle(request, env) {
  const device = await authenticate(request, env);
  if (!device) return json({ error: 'unauthorized' }, 401);
  const url = new URL(request.url), repo = new Repository(env.DB);
  if (request.method === 'GET' && url.pathname === '/v2/status') return json(await snapshot(repo));
  if (request.method === 'POST' && url.pathname === '/v2/session') {
    const text = await request.text();
    if (text.length > 512) return json({ error: 'invalid_session' }, 400);
    let body; try { body = JSON.parse(text); } catch { return json({ error: 'invalid_session' }, 400); }
    try {
      const ticket = await repo.mutate(s => beginSession(s, body.session, device, Date.now()));
      return json({ ticket, state: await snapshot(repo) });
    } catch (e) { if (e.message === 'invalid_session') return json({ error: e.message }, 400); throw e; }
  }
  if (request.method === 'POST' && url.pathname === '/v2/observations') {
    if (Number(request.headers.get('Content-Length')) > 131072) return json({ error: 'too_large' }, 413);
    const text = await request.text();
    if (text.length > 131072) return json({ error: 'too_large' }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: 'invalid_json' }, 400); }
    if (!Array.isArray(body.observations) || body.observations.length < 1 || body.observations.length > 25) return json({ error: 'invalid_batch' }, 400);
    try {
      const now = Date.now();
      const results = await repo.mutate(s => body.observations.map(o => observe(s, o, device, now)));
      return json({ now, results, state: await snapshot(repo) });
    } catch (e) { if (e.message === 'invalid_observation') return json({ error: e.message }, 400); throw e; }
  }
  if (request.method === 'POST' && url.pathname === '/v2/resume') {
    await repo.mutate(s => { s.authBlocked = false; });
    return json({ ok: true, state: await snapshot(repo) });
  }
  if (request.method === 'POST' && url.pathname === '/v2/manual') {
    const text = await request.text();
    if (text.length > 2048) return json({ error: 'invalid_manual' }, 400);
    let command;
    try { command = JSON.parse(text); } catch { return json({ error: 'invalid_manual' }, 400); }
    try {
      const now = Date.now();
      const result = await repo.mutate(s => manualReservation(s, command, device, now));
      return json({ now, ...result, state: await snapshot(repo) });
    } catch (e) {
      if (['invalid_manual', 'manual_limit', 'manual_not_found'].includes(e.message)) return json({ error: e.message }, 400);
      throw e;
    }
  }
  return json({ error: 'not_found' }, 404);
}
export async function dispatch(env, { now = () => Date.now(), send = fetch } = {}) {
  const repo = new Repository(env.DB), token = crypto.randomUUID();
  await repo.prune(now());
  console.info('dispatch_pruned');
  const d = await repo.mutate(s => { prune(s, now()); return claimDelivery(s, now(), token); });
  console.info(d ? 'dispatch_claimed' : 'dispatch_no_due');
  if (!d) return;
  // Revalidate after claiming. Slot updates can invalidate a queued payload before external send.
  const checked = await repo.mutate(s => {
    if (s.delivery?.token !== token) return null;
    s.delivery.items = s.delivery.items.filter(i => s.slots[i.key]?.generation === i.generation && s.slots[i.key]?.revision === i.revision);
    if (!s.delivery.items.length) { s.delivery = null; return null; }
    return structuredClone(s.delivery);
  });
  if (!checked) return;
  let result;
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) result = { ok: false, permanent: true, code: 'telegram_not_configured' };
  else try {
    const response = await send(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: formatDelivery(checked) }),
      signal: AbortSignal.timeout(15000)
    });
    const b = await response.json();
    result = response.ok && b.ok ? { ok: true, messageId: b.result?.message_id }
      : { ok: false, code: `telegram_${Number(b.error_code || response.status)}`,
        permanent: [400, 401, 403, 404].includes(Number(b.error_code || response.status)),
        retryAfter: Math.max(0, Number(b.parameters?.retry_after) || 0) * 1000 };
  } catch { result = { ok: false, code: 'transport', uncertain: true }; }
  await repo.mutate(s => finishDelivery(s, token, now(), result));
  console.info('dispatch_result', result.ok ? 'sent' : result.code);
}
export default {
  async fetch(request, env) { try { return await handle(request, env); } catch { return json({ error: 'server_error' }, 503); } },
  async scheduled(event, env) {
    console.info('scheduled_start', event.cron, event.scheduledTime);
    try {
      await dispatch(env);
      console.info('scheduled_complete');
    } catch {
      console.error('scheduled_failed');
      throw new Error('scheduled_dispatch_failed');
    }
  }
};
