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
  if (!message.text?.trim()) return json({ ok: true });
  const [command, ...args] = message.text.trim().split(/\s+/);
  const cmd = command.match(/^\/(offset|provider|providers|status|fleet|dock|build|help|test)(?:@[A-Za-z0-9_]+)?$/)?.[1];
  if (!cmd) {
    return json({
      method: 'sendMessage',
      chat_id: env.TELEGRAM_CHAT_ID,
      text: escapeHtml('コマンドが見つかりません。コマンド一覧を見るには /help を送信してください。'),
      parse_mode: 'HTML'
    });
  }
  let text;
  if (cmd === 'offset') {
    if (args.length === 0) {
      const state = await snapshot(repo);
      text = `現在のオフセット: ${state.settings.offsetSec}秒\n変更する場合: /offset <秒数>（-3600〜+3600）`;
    } else {
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
    }
  } else if (cmd === 'provider' || cmd === 'providers') {
    if (args.length === 2 && ['telegram', 'discord'].includes(args[0].toLowerCase()) && ['on', 'off', 'enable', 'disable'].includes(args[1].toLowerCase())) {
      const provider = args[0].toLowerCase();
      const enabled = ['on', 'enable'].includes(args[1].toLowerCase());
      text = await repo.mutate(s => {
        s.chatUpdates ||= {};
        if (!s.chatUpdates[body.update_id]) {
          const now = Date.now();
          applySettings(s, { providers: { [provider]: enabled } }, now);
          reconcile(s, now);
          s.chatUpdates[body.update_id] = { at: now, text: `${provider} を${enabled ? '有効' : '無効'}に設定しました` };
          for (const [id, update] of Object.entries(s.chatUpdates)) if (update.at < now - 7 * 86400000) delete s.chatUpdates[id];
        }
        return s.chatUpdates[body.update_id].text;
      });
    } else {
      const state = await snapshot(repo);
      const provList = Object.entries(state.settings.providers)
        .map(([p, en]) => `・${p}: ${en ? '有効' : '無効'}`)
        .join('\n');
      const recentHistory = (state.history || [])
        .filter(h => h.event === 'delivery_sent' || h.event === 'delivery_failed')
        .slice(-3)
        .map(h => {
          const p = h.data?.provider || '通知';
          const st = h.event === 'delivery_sent' ? '成功' : `失敗 (${h.data?.code || 'エラー'})`;
          return `${p}: ${st}`;
        });
      const historySection = recentHistory.length ? ['\n【直近の配信】', ...recentHistory.map(h => `・${h}`)] : [];
      text = [
        '【通知プロバイダ】',
        provList || 'なし',
        ...historySection,
        '\n切り替え: /provider <telegram|discord> <on|off>'
      ].join('\n');
    }
  } else if (cmd === 'test') {
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: '<b>【テスト通知】</b>\n艦これ通知の能動的API送信テストに成功しました！',
          parse_mode: 'HTML'
        })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        text = '✅ Telegram APIへの能動送信に成功しました！(MessageID: ' + (data.result?.message_id || 'ok') + ')';
      } else {
        text = `❌ Telegram API送信エラー: HTTP ${res.status}\n詳細: ${data.description || '不明'} (エラーコード: ${data.error_code || res.status})`;
      }
    } catch (e) {
      text = '❌ ネットワークエラー: ' + e.message;
    }
  } else if (cmd === 'help') {
    text = [
      '/status 次の通知タイミング一覧',
      '/fleet 艦隊の状態を表示',
      '/dock 入渠（修理リスト）を表示',
      '/build 建造ドックの状態を表示',
      '/offset [秒数] 通知時刻の確認・変更',
      '/provider プロバイダ状態の確認・変更',
      '/test Telegram通知の送信テスト',
      '/help この案内を表示'
    ].join('\n');
  } else {
    const state = await snapshot(repo);
    const now = state.now || Date.now();
    const offsetSec = state.settings?.offsetSec || 0;
    const effectiveTime = (kind, endAt) => {
      if (!Number.isSafeInteger(endAt)) return null;
      return endAt + (kind === 'manual' ? 0 : offsetSec * 1000);
    };

    const formatRemain = (endAt) => {
      if (!Number.isSafeInteger(endAt)) return '';
      const diff = endAt - now;
      const timeStr = new Date(endAt).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
      if (diff <= 0) return `(完了 / ${timeStr})`;
      const mins = Math.ceil(diff / 60000);
      const remain = mins >= 60 ? `${Math.floor(mins / 60)}時間${mins % 60}分` : `${mins}分`;
      return `(あと${remain} / ${timeStr})`;
    };

    if (cmd === 'fleet') {
      const fleetLines = [1, 2, 3, 4].map(slot => {
        const exp = state.timers.find(t => t.kind === 'expedition' && t.slot === slot);
        const akashi = state.timers.find(t => t.kind === 'akashi' && t.slot === slot);
        const fatigue = state.timers.find(t => t.kind === 'fatigue' && t.slot === slot);

        if (exp && exp.state === 'active') {
          return `第${slot}艦隊: 遠征「${exp.name}」 ${formatRemain(effectiveTime('expedition', exp.endAt))}`;
        }
        if (akashi && akashi.state === 'active') {
          const events = akashi.events || [];
          const earliestEvent = events.map(e => ({ ...e, effEndAt: effectiveTime('akashi', e.endAt) }))
            .filter(e => Number.isSafeInteger(e.effEndAt) && e.effEndAt > now).sort((a, b) => a.effEndAt - b.effEndAt)[0];
          const displayEvent = earliestEvent || events[0];
          const label = displayEvent?.text ? displayEvent.text : akashi.name ? `泊地修理「${akashi.name}」` : '泊地修理中';
          const displayTime = displayEvent?.effEndAt || effectiveTime('akashi', displayEvent?.endAt || akashi.endAt);
          return `第${slot}艦隊: ${label} ${formatRemain(displayTime)}`;
        }
        if (fatigue && fatigue.state === 'active') {
          return `第${slot}艦隊: 疲労回復中 ${formatRemain(effectiveTime('fatigue', fatigue.endAt))}`;
        }
        if (fatigue && fatigue.state === 'complete') {
          return `第${slot}艦隊: 待機中 (全快)`;
        }
        return `第${slot}艦隊: 待機中`;
      });
      text = ['【艦隊】', ...fleetLines].join('\n');
    } else if (cmd === 'dock') {
      const repairActive = state.timers
        .filter(t => t.kind === 'repair' && t.state === 'active')
        .sort((a, b) => (a.slot || 0) - (b.slot || 0));
      const repairLines = repairActive.length
        ? repairActive.map(t => `第${t.slot}ドック: ${t.name || '修理中'} ${formatRemain(effectiveTime('repair', t.endAt))}`)
        : ['全ドック空き'];
      if (repairActive.length && repairActive.length < 4) {
        repairLines.push(`（空き: ${4 - repairActive.length}ドック）`);
      }
      text = ['【入渠】', ...repairLines].join('\n');
    } else if (cmd === 'build') {
      const buildActive = state.timers
        .filter(t => t.kind === 'build' && t.state === 'active')
        .sort((a, b) => (a.slot || 0) - (b.slot || 0));
      const buildLines = buildActive.length
        ? buildActive.map(t => `第${t.slot}ドック: ${t.name || '建造中'} ${formatRemain(effectiveTime('build', t.endAt))}`)
        : ['全建造ドック空き'];
      text = ['【建造】', ...buildLines].join('\n');
    } else {
      // cmd === 'status'
      const items = [];
      for (const t of state.timers) {
        if (t.state !== 'active') continue;
        if (t.kind === 'expedition' && Number.isSafeInteger(t.endAt)) {
          items.push({ title: `第${t.slot}艦隊 遠征「${t.name}」`, endAt: effectiveTime(t.kind, t.endAt) });
        } else if (t.kind === 'repair' && Number.isSafeInteger(t.endAt)) {
          items.push({ title: `第${t.slot}ドック 入渠「${t.name || '修理中'}」`, endAt: effectiveTime(t.kind, t.endAt) });
        } else if (t.kind === 'build' && Number.isSafeInteger(t.endAt)) {
          items.push({ title: `第${t.slot}ドック 建造${t.name ? `「${t.name}」` : ''}`, endAt: effectiveTime(t.kind, t.endAt) });
        } else if (t.kind === 'manual' && Number.isSafeInteger(t.endAt)) {
          items.push({ title: `手動タイマー「${t.name}」`, endAt: effectiveTime(t.kind, t.endAt) });
        } else if (t.kind === 'fatigue' && Number.isSafeInteger(t.endAt)) {
          const condLabel = t.detail?.target ? `[cond${t.detail.target}]` : '';
          items.push({ title: `第${t.slot}艦隊 疲労回復完了${condLabel}`, endAt: effectiveTime(t.kind, t.endAt) });
        } else if (t.kind === 'akashi') {
          const events = (t.events || []).map(e => ({ ...e, effEndAt: effectiveTime('akashi', e.endAt) }))
            .filter(e => Number.isSafeInteger(e.effEndAt) && e.effEndAt > now - 60000);
          const repairEvents = events.filter(e => e.phase?.startsWith('repair_'));
          if (repairEvents.length) {
            for (const re of repairEvents) {
              const shipNames = re.text ? re.text.split('\n').map(l => l.split(':')[0].trim()).join('・') : '';
              const nameLabel = shipNames ? `「${shipNames}」` : '';
              items.push({ title: `第${t.slot}艦隊 泊地修理${nameLabel} 全快`, endAt: re.effEndAt });
            }
          } else if (Number.isSafeInteger(t.endAt)) {
            items.push({ title: `第${t.slot}艦隊 泊地修理`, endAt: effectiveTime('akashi', t.endAt) });
          }
        }
      }
      items.sort((a, b) => a.endAt - b.endAt);
      const itemLines = items.length
        ? items.map(item => `・${item.title} ${formatRemain(item.endAt)}`)
        : ['現在、通知予定はありません（待機中）'];
      text = ['【次の通知予定】', ...itemLines].join('\n');
    }
  }
  return json({
    method: 'sendMessage',
    chat_id: env.TELEGRAM_CHAT_ID,
    text: escapeHtml(text.slice(0, 3000)),
    parse_mode: 'HTML'
  });
}
