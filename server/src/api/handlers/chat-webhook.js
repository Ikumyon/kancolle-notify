import { json, readBody, snapshot } from './status.js';
import { applySettings, reconcile } from '../../domain/state.js';
import { labels, escapeHtml } from '../../notify/formatters/text.js';
export async function handleTelegramWebhook(request, env, repo) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID || !env.TELEGRAM_WEBHOOK_SECRET ||
    request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) return json({ error: 'forbidden' }, 403);
  const body = await readBody(request, 32768);
  const message = body?.message;
  if (!message) return json({ ok: true });
  if (String(message.chat?.id) !== String(env.TELEGRAM_CHAT_ID)) return json({ error: 'forbidden' }, 403);
  if (!Number.isSafeInteger(body.update_id)) return json({ error: 'invalid_update' }, 400);
  const [command, ...args] = String(message.text || '').trim().split(/\s+/);
  const cmd = command.match(/^\/(offset|status|help)(?:@[A-Za-z0-9_]+)?$/)?.[1];
  if (!cmd) return json({ ok: true });
  let text;
  if (cmd === 'offset') {
    const valid = args.length === 1 && /^[+-]?\d+$/.test(args[0]) && Math.abs(Number(args[0])) <= 3600;
    if (!valid) text = '使い方: /offset <秒数>（-3600〜+3600）';
    else text = await repo.mutate(s => {
      s.chatUpdates ||= {};
      if (!s.chatUpdates[body.update_id]) {
        const now = Date.now(); applySettings(s, { offsetSec: Number(args[0]) }, now); reconcile(s, now);
        s.chatUpdates[body.update_id] = { at: now, text: Number(args[0]) + '秒に設定しました' };
        for (const [id, update] of Object.entries(s.chatUpdates)) if (update.at < now - 7 * 86400000) delete s.chatUpdates[id];
      }
      return s.chatUpdates[body.update_id].text;
    });
  } else if (cmd === 'help') {
    text = '/offset <秒数> 通知時刻の変更\n/status 中央の状態を表示\n/help この案内を表示';
  } else {
    const state = await snapshot(repo);
    const active = state.timers.filter(t => t.state === 'active');
    text = ['中央の状態', 'オフセット: ' + state.settings.offsetSec + '秒',
      '有効プロバイダ: ' + (Object.entries(state.settings.providers).filter(([, enabled]) => enabled).map(([p]) => p).join(', ') || 'なし'),
      ...active.map(t => `${labels[t.kind]} ${t.slot || ''} ${t.name}: ${new Date(t.endAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`),
      ...(!active.length ? ['稼働中のタイマーはありません'] : [])].join('\n');
  }
  try {
    const response = await (env.NOTIFICATION_SEND || fetch)(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: escapeHtml(text.slice(0, 3000)), parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) return json({ error: 'reply_failed' }, 503);
    return json({ ok: true });
  } catch { return json({ error: 'reply_failed' }, 503); }
}
