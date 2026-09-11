import { repairLine, MIN_REPAIR } from './core/akashi.js';
import { jstTimestamp } from './core/manual.js';
import { isNotified, visibleReservation, remainingText } from './core/display.js';
import { targetFor, fleetMinCond } from './core/fatigue.js';
const $ = s => document.querySelector(s);
const time = n => n ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'medium' }).format(n) : '—';
const labels = { akashi: '泊地修理', expedition: '遠征', repair: '入渠', build: '建造', fatigue: '疲労回復', active: '予定あり', pending: '終了時刻待ち', empty: '空き', complete: '完了',
  sent: '通知送信', observation: '予定の観測', parse_error: '取得エラー', send_error: '配信エラー',
  applied: '反映済み', stale_session: '別のプレイが開始されたため不採用', session_start: 'プレイ開始',
  accepted: '中央受理済み', duplicate: '再送分・重複受理', stale: '古い情報のため不採用', same: '同じ予定・変更なし',
  snapshot: '状態取得', start: '開始', change: '予定変更', manual: '手動予約', create: '登録', cancel: '取消', cancelled: '取消済み', manual_create: '手動予約登録', manual_cancel: '手動予約取消' };
const messages = { stale_session: '別のプレイに切り替わったため、このプレイからの送信を停止しました', not_configured: '設定が必要です', authentication: '接続トークンを確認してください', connection: '中央に接続できません',
  invalid_data: '送信データの確認が必要です', invalid_reply: '中央の応答を確認できません' };
async function call(type, extra = {}) { const r = await chrome.runtime.sendMessage({ type, ...extra }); if (r.error) throw new Error(r.error); return r.value; }
let akashiView = [];
function renderAkashi(now) {
  const container = $('#akashi-fleets'); if (!container) return;
  container.replaceChildren();
  for (const fleet of akashiView) {
    const card = document.createElement('article'); card.className = 'akashi-card';
    const heading = document.createElement('h3'); heading.textContent = `第${fleet.slot}艦隊`; card.append(heading);
    const note = document.createElement('p'); note.className = 'muted';
    note.textContent = !fleet.repair ? fleet.name || '情報待ち' : !Number.isFinite(now) ? '時刻未取得' : now < fleet.repair.start + MIN_REPAIR ? `修理開始まであと${Math.ceil((fleet.repair.start + MIN_REPAIR - now) / 60000)}分` : 'HP回復見込み'; card.append(note);
    if (fleet.repair && Number.isFinite(now)) for (const ship of fleet.repair.ships) {
      const row = document.createElement('p'); row.className = 'akashi-ship'; row.textContent = repairLine(ship, fleet.repair.start, now); card.append(row);
    }
    container.append(card);
  }
  if (!akashiView.length) container.textContent = '母港の情報待ち';
}
let busy = false, rerender = false;
let timeMode = 'absolute', displayNow = null, displayAnchor = 0;
const viewReady = chrome.storage.local.get('timeMode').then(r => { timeMode = r.timeMode === 'remaining' ? 'remaining' : 'absolute'; });
function updateDeadlines() {
  const now = displayNow === null ? null : displayNow + performance.now() - displayAnchor;
  renderAkashi(now);
  for (const node of document.querySelectorAll('[data-end]')) {
    const end = Number(node.dataset.end);
    node.textContent = timeMode === 'remaining' ? remainingText(end, now) : time(end);
    node.title = `${time(end)}（日本時間）`;
  }
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === timeMode));
}
function deadline(r) {
  const p = document.createElement('p'); p.className = 'deadline';
  if (r.state === 'active' && r.end) p.dataset.end = r.end;
  else p.textContent = r.kind === 'fatigue' ? r.name || labels[r.state] : labels[r.state] || '未計測';
  return p;
}
function dockReservations(data, hideBuildName = false) {
  const container = $('#dock-reservations'); if (!container) return;
  const slots = data?.slots || {};

  for (let slot = 1; slot <= 4; slot++) {
    // 入渠
    const repair = slots[`repair:${slot}`];
    const rName = $(`#repair-name-${slot}`);
    const rTime = $(`#repair-time-${slot}`);
    if (rName && rTime) {
      if (repair && repair.state === 'active' && repair.end) {
        rName.textContent = repair.name || '修復中';
        rName.className = 'dock-name';
        rName.title = rName.textContent;
        rTime.className = 'deadline';
        rTime.dataset.end = repair.end;
      } else if (repair && repair.state === 'complete') {
        rName.textContent = repair.name || '完了';
        rName.className = 'dock-name';
        rName.title = rName.textContent;
        delete rTime.dataset.end;
        rTime.className = 'deadline good';
        rTime.textContent = '完了';
      } else {
        rName.textContent = '—';
        rName.className = 'dock-name muted';
        rName.title = '';
        delete rTime.dataset.end;
        rTime.className = 'deadline expedition-none';
        rTime.textContent = '--:--';
      }
    }

    // 建造
    const build = slots[`build:${slot}`];
    const bName = $(`#build-name-${slot}`);
    const bTime = $(`#build-time-${slot}`);
    if (bName && bTime) {
      if (build && build.state === 'active' && build.end) {
        bName.textContent = hideBuildName ? '建造中' : (build.name || '建造中');
        bName.className = 'dock-name';
        bName.title = bName.textContent;
        bTime.className = 'deadline';
        bTime.dataset.end = build.end;
      } else if (build && build.state === 'complete') {
        bName.textContent = hideBuildName ? '完成' : (build.name || '完了');
        bName.className = 'dock-name';
        bName.title = bName.textContent;
        delete bTime.dataset.end;
        bTime.className = 'deadline good';
        bTime.textContent = '完了';
      } else {
        bName.textContent = '—';
        bName.className = 'dock-name muted';
        rName?.title && (bName.title = '');
        delete bTime.dataset.end;
        bTime.className = 'deadline expedition-none';
        bTime.textContent = '--:--';
      }
    }
  }
}
function renderFleetGrid(local, data) {
  if (!$('#fleet-grid')) return;
  const settings = local?.fatigueSettings || { presets: [], defaultTarget: null, fleets: {} };
  const presets = Array.isArray(settings.presets) ? settings.presets : [];
  const fatigueList = Array.isArray(local?.fatigue) ? local.fatigue : [];
  const expeditions = Object.values(data?.slots || {}).filter(r => r && r.kind === 'expedition');

  for (let fleet = 1; fleet <= 4; fleet++) {
    // 1. 最低cond値
    let minCond = null;
    try { minCond = fleetMinCond(local?.fatigueSnapshot, fleet); } catch {}
    const condBadge = $(`#fleet-cond-${fleet}`);
    if (condBadge) {
      if (minCond === null || minCond === undefined) {
        condBadge.textContent = '—';
        condBadge.className = 'cond-badge cond-none';
        condBadge.title = '艦娘データなし';
      } else {
        condBadge.textContent = minCond;
        condBadge.title = `第${fleet}艦隊 最低cond: ${minCond}`;
        if (minCond >= 50) condBadge.className = 'cond-badge cond-kira';
        else if (minCond >= 40) condBadge.className = 'cond-badge cond-normal';
        else if (minCond >= 30) condBadge.className = 'cond-badge cond-tired';
        else condBadge.className = 'cond-badge cond-bad';
      }
    }

    // 2. 目標値プリセットボタン
    const presetsBox = $(`#fleet-presets-${fleet}`);
    if (presetsBox) {
      const target = targetFor(settings, fleet);
      const currentKeys = Array.from(presetsBox.querySelectorAll('button')).map(b => b.dataset.target).join(',');
      const newKeys = presets.join(',');
      if (currentKeys !== newKeys) {
        presetsBox.replaceChildren();
        for (const value of presets) {
          const b = document.createElement('button'); b.type = 'button'; b.textContent = value;
          b.dataset.fleet = fleet; b.dataset.target = value; b.setAttribute('aria-pressed', String(target === value));
          b.addEventListener('click', async () => {
            b.disabled = true;
            try { await call('fatigue-target', { fleet, target: value }); await render(); }
            catch { $('#notice').textContent = '目標値を保存できませんでした。'; b.disabled = false; }
          });
          presetsBox.append(b);
        }
      } else {
        for (const b of presetsBox.querySelectorAll('button')) {
          b.setAttribute('aria-pressed', String(Number(b.dataset.target) === target));
        }
      }
    }

    // 3. 疲労回復時刻
    const central = data?.slots?.[`fatigue:${fleet}`], current = fatigueList.find(r => r.slot === fleet);
    const r = current || central;
    const fTime = $(`#fleet-fatigue-time-${fleet}`);
    const fNote = $(`#fleet-fatigue-note-${fleet}`);
    if (fTime) {
      if (r && r.state === 'active' && r.end) {
        fTime.className = 'deadline';
        fTime.dataset.end = r.end;
      } else {
        delete fTime.dataset.end;
        fTime.className = 'deadline expedition-none';
        fTime.textContent = '--:--';
      }
    }
    if (fNote) {
      if (r && r.state === 'active') {
        let noteText = r.name || '';
        if (!central || central.end !== r.end || central.subject !== r.subject || central.state !== r.state) noteText += (noteText ? '／' : '') + '中央への反映待ち';
        else if (isNotified(central)) noteText += (noteText ? '／' : '') + '通知済み';
        fNote.textContent = noteText;
        fNote.hidden = !noteText;
      } else {
        fNote.textContent = '';
        fNote.hidden = true;
      }
    }

    // 4. 遠征（全艦隊：出撃していない時は --:-- を表示）
    const exp = expeditions.find(e => e.slot === fleet && visibleReservation(e));
    const expName = $(`#fleet-exp-name-${fleet}`);
    const expTime = $(`#fleet-exp-time-${fleet}`);
    if (expName && expTime) {
      if (exp && exp.state === 'active' && exp.end) {
        expName.textContent = exp.name || '遠征中';
        expName.className = 'expedition-name';
        expName.title = exp.name || '';
        expTime.className = 'deadline';
        expTime.dataset.end = exp.end;
      } else {
        expName.textContent = fleet === 1 ? '—' : (exp?.name || '未出撃');
        expName.className = 'expedition-name muted';
        expName.title = '';
        delete expTime.dataset.end;
        expTime.className = 'deadline expedition-none';
        expTime.textContent = '--:--';
      }
    }
  }
}
function renderInformation(selector, records, sent) {
  const container = $(selector); if (!container) return;
  container.replaceChildren();
  if (!records.length) {
    container.textContent = sent ? 'まだ送信済みの情報はありません。' : '送信待ちの情報はありません。'; return;
  }
  for (const record of [...records].reverse()) {
    const card = document.createElement('article'); card.className = 'receipt';
    const line = (text, className = '') => { const p = document.createElement('p'); p.textContent = text; p.className = className; card.append(p); };
    line(sent ? `中央受信：${time(record.receivedAt)}` : '未送信・中央の受理待ち', 'muted');
    for (const e of record.events || []) {
      line(e.kind === 'manual' ? `手動予約／${e.name}` : `${labels[e.kind]} ${['expedition', 'fatigue', 'akashi'].includes(e.kind) ? '第' + e.slot + '艦隊' : '第' + e.slot + 'ドック'}${e.name ? '／' + e.name : ''}`);
      line(`${labels[e.action] || e.action}・${labels[e.state] || e.state}　終了予定：${time(e.end)}`);
      const outcome = record.result?.results?.find(r => r.key === `${e.kind}:${e.slot}`)?.status || record.result?.status;
      if (sent) line(labels[outcome] || outcome || '受理結果不明', outcome === 'stale_session' ? 'error' : '');
    }
    if (record.errors?.length) line(`取得エラー：${record.errors.join('、')}`, 'error');
    const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
    summary.textContent = sent ? '送信した項目を見る' : '送信予定の項目を見る';
    pre.textContent = JSON.stringify({ session: record.session, seq: record.seq, epoch: record.epoch, generation: record.generation, events: record.events, errors: record.errors }, null, 2);
    details.append(summary, pre); card.append(details); container.append(card);
  }
}
async function render(remote = false) {
  if (busy) { rerender = true; return; } busy = true;
  try {
    await viewReady;
    const local = await call('local'); let data = local.cache, failed = '';
    renderInformation('#sent-information', local.recentSent || [], true);
    renderInformation('#pending-information', local.pending || [], false);
    if (local.configured && remote) try { data = await call('remote'); } catch (e) { failed = messages[e.message] || '中央に接続できません'; }
    displayNow = Number.isFinite(data?.cachedAt) && Date.now() >= data.cachedAt ? data.now + Date.now() - data.cachedAt : Date.now();
    displayAnchor = performance.now();
    const isTestMode = !!(local.testMode || local.url === 'http://127.0.0.1:8787' || local.url?.includes('localhost'));
    const modeBadge = $('#mode-badge'); if (modeBadge) modeBadge.hidden = !isTestMode;
    akashiView = local.akashi?.length ? local.akashi : Object.values(data?.slots || {}).filter(r => r.kind === 'akashi');
    renderFleetGrid(local, data); dockReservations(data, local.hideBuildName);
    if ($('#manual-reservations')) {
      $('#manual-retry').hidden = !local.pendingManual;
      $('#manual-submit').disabled = !!local.pendingManual;
      if (local.pendingManual) $('#manual-notice').textContent = '中央の受理結果を確認できていない手動予約があります。「受理結果を確認・再送」で同じ予約を確認します。';
      const container = $('#manual-reservations'); container.replaceChildren();
      for (const [key, r] of Object.entries(data?.slots || {}).filter(([, r]) => r.kind === 'manual' && visibleReservation(r))) {
        const p = document.createElement('article'), button = document.createElement('button'); p.className = 'reservation';
        p.textContent = `${r.name}　`; p.append(deadline(r)); button.textContent = '取消'; button.type = 'button';
        button.addEventListener('click', async () => {
          button.disabled = true;
          try { await call('manual', { command: { action: 'cancel', id: key.slice(7) } }); $('#manual-notice').textContent = '予約を取り消しました。'; }
          catch (e) { $('#manual-notice').textContent = manualError(e); }
          await render();
        });
        p.append(button); container.append(p);
      }
    }
    $('#notice').textContent = !local.configured ? '最初に設定画面で中央サービスへ接続してください。'
      : failed || (local.lastError ? messages[local.lastError] || local.lastError : data?.authBlocked ? '中央の配信が停止中です。配信設定を確認してください。' : $('#summary') ? '中央サービスに接続しています。' : '');
    const lines = [`未送信：${local.queued}件`, `最終同期：${time(local.lastSync)}`];
    lines.push('取得にはゲームタブのDevToolsが必要です。');
    $('#summary')?.replaceChildren(...lines.map(text => { const p = document.createElement('p'); p.textContent = text; return p; }));
    const table = $('#reservations');
    if (table) {
      table.replaceChildren();
      for (const r of Object.values(data?.slots || {})) {
        const tr = document.createElement('tr');
        for (const v of [`${labels[r.kind]} ${r.slot ?? ''}${r.name ? ' ' + r.name : ''}`, isNotified(r) ? '通知済み' : labels[r.state], time(r.end), '反映済み']) {
          const td = document.createElement('td'); td.textContent = v; tr.append(td);
        }
        table.append(tr);
      }
      $('#history').replaceChildren(...(data?.history || []).map(h => {
        const li = document.createElement('li');
        li.textContent = `${time(h.at)} ${labels[h.type] || h.type} ${h.key || ''} ${labels[h.status] || h.code || ''}`; return li;
      }));
    }
    updateDeadlines();
  } catch { $('#notice').textContent = '状態を読み取れません。画面を開き直してください。'; }
  finally { busy = false; if (rerender) { rerender = false; render(); } }
}
$('#refresh')?.addEventListener('click', () => render(true));
function manualError(e) {
  return ({ invalid_manual: '未来の日時、または1分以上の時間を入力してください。', invalid_data: '予約できませんでした。日時・通知名・未通知予約数（最大10件）を確認してください。',
    manual_pending: '前の手動予約の受理結果を確認・再送してください。', not_configured: '最初に中央サービスへの接続を設定してください。',
    authentication: '接続トークンを確認してください。' })[e.message] || '中央の受理結果を確認できません。接続復旧後に同じ予約を再送してください。';
}
$('#manual-mode')?.addEventListener('change', () => {
  const minutes = $('#manual-mode').value === 'minutes';
  $('#minutes-field').hidden = !minutes; $('#datetime-field').hidden = minutes;
  $('#manual-minutes').required = minutes; $('#manual-datetime').required = !minutes;
});
$('#manual-form')?.addEventListener('submit', async e => {
  e.preventDefault(); $('#manual-submit').disabled = true;
  try {
    const mode = $('#manual-mode').value;
    const command = { action: 'create', title: $('#manual-title').value.trim(), mode,
      ...(mode === 'minutes' ? { minutes: Number($('#manual-minutes').value) } : { end: jstTimestamp($('#manual-datetime').value) }) };
    const result = await call('manual', { command });
    $('#manual-notice').textContent = `予約しました：${time(result.reservation.end)}（日本時間）`;
  } catch (error) { $('#manual-notice').textContent = manualError(error); }
  $('#manual-submit').disabled = false; await render();
});
$('#manual-retry')?.addEventListener('click', async () => {
  try { await call('manual-retry'); $('#manual-notice').textContent = '中央の受理を確認しました。'; }
  catch (e) { $('#manual-notice').textContent = manualError(e); }
  await render();
});
for (const type of ['retry', 'resume']) $(`#${type}`)?.addEventListener('click', async () => { try { await call(type); await render(); } catch { $('#notice').textContent = '再開できません。設定を確認してください。'; } });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ['queue', 'lastSync', 'lastError', 'recentSent', 'remoteCache', 'fatigueSettings', 'fatigueSnapshot', 'akashi', 'hideBuildName'].some(k => k in changes)) render();
});
for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', async () => {
  timeMode = b.dataset.mode; updateDeadlines(); await chrome.storage.local.set({ timeMode });
});
// UI-only ticking; never polls the central service or the game.
if ($('#time-mode')) setInterval(updateDeadlines, 1000);
render();
