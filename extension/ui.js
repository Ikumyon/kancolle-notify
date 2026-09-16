import { time, remainingText, statusLabels } from './core/display.js';
import { repairProgress } from './core/recovery.js';
const $ = selector => document.querySelector(selector);
const call = async (type, extra = {}) => {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (response?.error) throw new Error(response.error); return response.value;
};
const isPopup = document.body.classList.contains('popup');
let view, popupView, loading = false, dirty = false, changingTarget = false;
let timeMode = 'remaining', clockAnchor = 0;
function node(tag, text, className) {
  const n = document.createElement(tag); n.textContent = text;
  if (className) n.className = className; return n;
}
function receipt(parent, id) {
  const r = view.receipts[id];
  if (r) parent.append(node('small', time(r.observedAt) + ' ・ ' + statusLabels[r.status] + (r.error ? ' (' + r.error + ')' : ''), 'receipt'));
}
function render() {
  $('#notice').textContent = view.observedAt ? '最終読取: ' + time(view.observedAt) + (view.collector ? ' ・ 監視中' : ' ・ 監視停止') : '未観測';
  $('#collector-error').textContent = view.error ? '読取エラー: ' + view.error : '';
  const labels = { expedition: '遠征', fatigue: '疲労回復', akashi: '泊地修理', repair: '入渠', build: '建造' };
  const states = { active: '予定あり', pending: '情報待ち', complete: '完了（観測・計算結果）', empty: '対象なし', cancelled: '取消' };
  const cardFor = (t, id) => {
    const card = node('article', '', 'observation-card');
    card.append(node('h3', labels[t.kind] + ' ・ 第' + t.slot + (['repair', 'build'].includes(t.kind) ? 'ドック' : '艦隊')));
    card.append(node('p', t.name), node('p', states[t.state]));
    for (const event of t.events) {
      card.append(node('p', (event.phase === 'start' ? '開始予定' : event.phase === 'full' ? '全回復予定' : '終了予定') + ': ' + (event.endAt ? time(event.endAt) : '未定')));
      if (event.endAt) { const p = node('p', '', 'countdown'); p.dataset.end = event.endAt; card.append(p); }
    }
    receipt(card, id); return card;
  };
  for (const group of ['fleets', 'repair', 'build']) {
    const container = $('#' + group); container.replaceChildren();
    for (const row of Object.values(view.timers)) if (group === 'fleets' ? ['expedition', 'fatigue', 'akashi'].includes(row.data.kind) : row.data.kind === group) container.append(cardFor(row.data, row.observationId));
    if (!container.children.length) container.append(node('p', '未観測', 'muted'));
  }
  const history = $('#operations'); history.replaceChildren();
  for (const update of view.updates) {
    const details = node('details', ''); details.append(node('summary', (update.reason === 'settings' ? '目標cond変更' : '読取による更新') + ' ・ ' + update.timers.length + '件'));
    receipt(details, update.observationId);
    for (const timer of update.timers) details.append(cardFor(timer, update.observationId));
    history.append(details);
  }
  if (!view.updates.length) history.append(node('p', '送信するタイマーはありません', 'muted'));
  countdown();
}
function popupDeadline(element, endAt, empty = '未観測') {
  delete element.dataset.end;
  if (Number.isSafeInteger(endAt) && endAt > 0) element.dataset.end = endAt;
  else element.textContent = empty;
}
function renderPopup(data) {
  popupView = data; clockAnchor = performance.now();
  $('#notice').textContent = data.observedAt ? '読取 ' + time(data.observedAt) + (data.collector ? '' : ' ・ 監視停止') : '未観測';
  if (data.error) $('#notice').textContent += ' ・ 読取エラー';
  $('#send-summary').textContent = data.sending ? '送信待ち・送信中: ' + data.sending + '件' : '送信内容は詳細ページで確認できます';
  for (const fleet of data.fleets) {
    const cond = $('#fleet-cond-' + fleet.slot);
    cond.textContent = fleet.minCond ?? '—';
    cond.className = 'cond-badge ' + (fleet.minCond === null ? 'cond-none' : fleet.minCond >= 50 ? 'cond-kira' : fleet.minCond >= 40 ? 'cond-normal' : fleet.minCond >= 20 ? 'cond-tired' : 'cond-bad');
    cond.title = fleet.ships.map(s => s.name + ' ' + (s.hp ?? '—') + '/' + (s.maxHp ?? '—')).join('\n');
    const container = $('#fleet-presets-' + fleet.slot); container.replaceChildren();
    const presets = [...(data.settings?.fatiguePresets || [40, 49])];
    if (fleet.target !== null && !presets.includes(fleet.target)) presets.push(fleet.target);
    for (const target of presets) {
      const button = node('button', String(target)); button.type = 'button';
      button.setAttribute('aria-pressed', String(fleet.target === target)); button.disabled = !data.settings || changingTarget;
      button.title = '第' + fleet.slot + '艦隊の目標condを拡張へ保存';
      button.addEventListener('click', async () => {
        if (changingTarget) return;
        changingTarget = true;
        for (const b of document.querySelectorAll('#fleet-grid .segments button')) b.disabled = true;
        try {
          await call('calculation-settings', { patch: { fatigueTargets: { [fleet.slot]: fleet.target === target ? null : target } } });
          $('#settings-notice').textContent = '第' + fleet.slot + '艦隊の目標condを保存しました';
        } catch (e) { $('#settings-notice').textContent = '目標condを保存できません: ' + e.message; }
        finally { changingTarget = false; await refresh(); }
      }); container.append(button);
    }
    const f = fleet.fatigue;
    popupDeadline($('#fleet-fatigue-time-' + fleet.slot), f.endAt, f.state === 'complete' ? '目標到達' : f.state === 'empty' ? '所属艦なし' : f.detail.reason);
    const note = $('#fleet-fatigue-note-' + fleet.slot);
    note.hidden = !f.endAt; note.textContent = '自然回復の見込み';
    if (fleet.slot >= 2) {
      const mission = fleet.mission;
      $('#fleet-exp-name-' + fleet.slot).textContent = !mission ? '未観測' : mission[0] === 0 ? '待機' : fleet.missionName || '遠征中';
      popupDeadline($('#fleet-exp-time-' + fleet.slot), mission?.[0] > 0 ? mission[2] : null, !mission ? '未観測' : mission[0] === 0 ? '—' : '時刻未観測');
    }
  }
  for (const kind of ['repair', 'build']) for (const dock of data[kind]) {
    const empty = dock.state === null ? '未観測' : dock.state < 0 ? '未開放' : dock.state === 0 ? '空き' : kind === 'build' && dock.state === 3 ? '建造完了' : dock.name;
    const name = $('#' + kind + '-name-' + dock.slot); name.textContent = empty;
    popupDeadline($('#' + kind + '-time-' + dock.slot), dock.state > 0 && !(kind === 'build' && dock.state === 3) ? dock.endAt : null, dock.state === null ? '未観測' : '—');
  }
  countdown();
}
function renderPopupAkashi(now) {
  const container = $('#akashi-fleets'); container.replaceChildren();
  for (const fleet of popupView.akashi) {
    const card = node('article', '', 'akashi-card'); card.append(node('h3', '第' + fleet.slot + '艦隊'));
    if (fleet.state !== 'active') card.append(node('p', fleet.detail.reason || '修理対象なし', 'muted'));
    else {
      card.append(node('p', now < fleet.detail.firstAt ? '修理開始まで ' + remainingText(fleet.detail.firstAt, now) : '最初の20分経過（見込み）'));
      card.append(node('p', '全回復まで ' + remainingText(fleet.endAt, now)));
      for (const ship of fleet.detail.ships) {
        const progress = repairProgress(ship, fleet.detail.startAt, now);
        card.append(node('p', ship.name + ': ' + ship.hp + '/' + ship.maxHp + ' → ' + progress.hpNow + '/' + ship.maxHp + ' (+' + progress.healed + ')', 'akashi-ship'));
      }
    }
    container.append(card);
  }
}
function countdown() {
  const now = isPopup && popupView ? popupView.now + performance.now() - clockAnchor : Date.now();
  for (const item of document.querySelectorAll('[data-end]')) {
    const endAt = Number(item.dataset.end);
    item.textContent = isPopup ? timeMode === 'remaining' ? remainingText(endAt, now) : time(endAt) : '残り ' + remainingText(endAt, now);
    item.title = time(endAt) + '（観測・見込み時刻）';
  }
  if (isPopup && popupView) renderPopupAkashi(now);
}
async function refresh() {
  if (loading) { dirty = true; return; }
  loading = true;
  try { if (isPopup) renderPopup(await call('popup')); else { view = await call('view'); render(); } }
  catch (e) { $('#notice').textContent = '観測情報の取得に失敗: ' + e.message; }
  finally { loading = false; if (dirty) { dirty = false; void refresh(); } }
}
chrome.runtime.onMessage.addListener(message => { if (message.type === 'view-changed') void refresh(); });
$('#retry')?.addEventListener('click', () => call('retry').catch(e => { $('#notice').textContent = e.message; }));
const timer = setInterval(countdown, 1000);
window.addEventListener('unload', () => clearInterval(timer));
void refresh();

if (isPopup) {
  for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => {
    timeMode = button.dataset.mode;
    for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b === button));
    countdown();
  });
  call('settings').catch(() => { $('#settings-notice').textContent = '中央に接続できません。目標condは拡張内で変更できます。'; });
}
