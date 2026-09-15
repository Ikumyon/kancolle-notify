import { json } from './status.js';
import { getOffsetSec } from '../../domain/timer.js';

const date = n => new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
}).format(n);

async function replyTelegram(env, chatId, text) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10000)
    });
  } catch (e) {
    console.error('telegram_reply_error', e);
  }
}

export async function handleTelegramWebhook(request, env, repo) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return json({ error: 'telegram_not_configured' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const message = body.message || body.edited_message;
  if (!message) return json({ ok: true });

  const chatId = String(message.chat?.id || '');
  if (chatId !== String(env.TELEGRAM_CHAT_ID)) {
    return json({ error: 'forbidden' }, 403);
  }

  const text = (message.text || '').trim();
  const [cmd, ...args] = text.split(/\s+/);

  if (cmd.startsWith('/offset')) {
    if (!args.length) {
      const { state } = await repo.read();
      const cur = getOffsetSec(state);
      const desc = cur < 0 ? `${Math.abs(cur)}秒早める設定` : cur > 0 ? `${cur}秒遅くする設定` : '定刻通知（調整なし）';
      await replyTelegram(env, chatId, `現在の通知調整設定: ${cur > 0 ? '+' : ''}${cur}秒 (${desc}) です。`);
      return json({ ok: true });
    }

    const val = Number(args[0]);
    if (!Number.isInteger(val) || val < -3600 || val > 3600) {
      await replyTelegram(env, chatId, `無効な値です。-3600 から +3600 の整数を指定してください。\n例: /offset -59 (59秒早める)`);
      return json({ ok: true });
    }

    await repo.mutate(s => {
      s.offsetSec = val;
      s.notificationAdvanceSec = val < 0 ? -val : 0;
      if (s.delivery && !s.delivery.uncertain && s.delivery.leaseUntil <= Date.now()) {
        s.delivery = null;
      }
    });

    const desc = val < 0 ? `${Math.abs(val)}秒早める設定` : val > 0 ? `${val}秒遅くする設定` : '定刻通知（調整なし）';
    await replyTelegram(env, chatId, `通知時刻の調整を ${val > 0 ? '+' : ''}${val}秒 (${desc}) に更新しました。`);
    return json({ ok: true });
  }

  if (cmd.startsWith('/status')) {
    const { state } = await repo.read();
    const now = Date.now();
    const active = Object.values(state.slots || {}).filter(s => s.state === 'active' && s.end);

    if (!active.length) {
      await replyTelegram(env, chatId, '現在進行中の遠征・入渠・建造はありません。');
      return json({ ok: true });
    }

    const labels = { expedition: '遠征', repair: '入渠', build: '建造', fatigue: '疲労回復', manual: '手動' };
    const lines = active.map(s => {
      const remainingMin = Math.max(0, Math.ceil((s.end - now) / 60000));
      const target = s.kind === 'manual' ? s.name : `${labels[s.kind] || s.kind} 第${s.slot}${s.name ? ' ' + s.name : ''}`;
      return `・${target}: ${date(s.end)} 完了見込み (残り約${remainingMin}分)`;
    });

    await replyTelegram(env, chatId, `【現在の稼働状態】\n${lines.join('\n')}`);
    return json({ ok: true });
  }

  if (cmd.startsWith('/help') || cmd.startsWith('/start')) {
    const help = [
      '【艦これ通知 コマンド一覧】',
      '・/offset <秒数> : 通知時刻のオフセットを変更 (-3600〜+3600)',
      '  例: /offset -59 (59秒早める)',
      '  例: /offset +60 (1分遅くする)',
      '  例: /offset 0 (定刻通知)',
      '・/offset : 現在のオフセット設定値を確認',
      '・/status : 進行中の予定一覧を確認',
      '・/help : このヘルプを表示'
    ].join('\n');
    await replyTelegram(env, chatId, help);
    return json({ ok: true });
  }

  return json({ ok: true });
}
