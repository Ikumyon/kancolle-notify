import { readFatigueTarget, readFatiguePresets } from './fatigue-settings.js';
import { settingsPatch } from './notification-settings.js';
const $ = selector => document.querySelector(selector);
const call = async (type, extra = {}) => {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('バックグラウンド応答タイムアウト（拡張機能を再読み込みしてください）')), 5000));
  const send = (async () => {
    const r = await chrome.runtime.sendMessage({ type, ...extra });
    if (r?.error) throw new Error(r.error); return r?.value;
  })();
  return Promise.race([send, timeout]);
};
const notice = text => { $('#notice').textContent = text; };
const setNotice = (selector, text, isError = false) => {
  const el = $(selector);
  if (el) { el.textContent = text; el.className = 'form-notice ' + (isError ? 'error' : 'success'); }
};
async function action(fn) { try { await fn(); } catch (e) { notice('操作に失敗しました: ' + e.message); } }
async function loadSettings() {
  const s = await call('settings');
  $('#offset').value = s.offsetSec; $('#hide-build').checked = s.hideBuildName;
  for (const input of document.querySelectorAll('[data-provider]')) input.checked = s.providers[input.dataset.provider];
  for (const input of document.querySelectorAll('[data-category]')) input.checked = s.categories[input.dataset.category];
  $('#settings-fields').disabled = false;
}
async function loadManual() {
  const { reservations } = await call('manual-list'), list = $('#manual-list'); list.replaceChildren();
  for (const r of reservations) {
    const row = document.createElement('p');
    row.textContent = r.name + ' ・ ' + (r.endAt ? new Date(r.endAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '') + ' ・ ' + ({ active: '予約中', cancelled: '取消済み', complete: '完了' }[r.state] || r.state);
    if (r.state === 'active') {
      const button = document.createElement('button'); button.textContent = '取消';
      button.addEventListener('click', () => action(async () => { await call('manual-cancel', { id: r.id.slice(7) }); await loadManual(); notice('取り消しました'); }));
      row.append(button);
    }
    list.append(row);
  }
  if (!reservations.length) list.textContent = '手動予約はありません';
}
$('#connection-form').addEventListener('submit', event => {
  event.preventDefault();
  const btn = $('#connection-form button'); btn.disabled = true;
  setNotice('#connection-notice', '保存中…');
  void (async () => {
    try {
      await call('configure', { url: $('#url').value.trim(), token: $('#token').value.trim() });
      setNotice('#connection-notice', '✅ 接続情報を保存しました');
      notice('接続情報を保存しました');
      try { await loadSettings(); await loadManual(); } catch {
        setNotice('#connection-notice', '✅ 接続情報を保存しました（通知設定の取得中…）');
      }
    } catch (e) {
      setNotice('#connection-notice', '❌ 保存失敗: ' + e.message, true);
      notice('操作に失敗しました: ' + e.message);
    } finally { btn.disabled = false; }
  })();
});
$('#calculation-form').addEventListener('submit', event => {
  event.preventDefault();
  const btn = $('#calculation-form button'); btn.disabled = true;
  void (async () => {
    try {
      await call('calculation-settings', { patch: { fatigueTarget: readFatigueTarget($('#fatigue-target')), fatiguePresets: readFatiguePresets($('#fatigue-presets')) } });
      setNotice('#calculation-notice', '✅ 拡張へ保存しました');
      notice('拡張へ保存し、回復予定を再計算しました');
    } catch (e) {
      setNotice('#calculation-notice', '❌ 保存失敗: ' + e.message, true);
      notice('操作に失敗しました: ' + e.message);
    } finally { btn.disabled = false; }
  })();
});
$('#settings-form').addEventListener('submit', event => {
  event.preventDefault();
  const btn = $('#settings-form button'); btn.disabled = true;
  void (async () => {
    try {
      await call('settings', { patch: settingsPatch(document) });
      setNotice('#settings-notice', '✅ 中央へ保存しました');
      notice('中央へ保存しました');
    } catch (e) {
      setNotice('#settings-notice', '❌ 保存失敗: ' + e.message, true);
      notice('操作に失敗しました: ' + e.message);
    } finally { btn.disabled = false; }
  })();
});
$('#reload-settings').addEventListener('click', () => action(async () => { await loadSettings(); notice('通知設定を取得しました'); }));
$('#reload-manual').addEventListener('click', () => action(loadManual));
$('#manual-mode').addEventListener('change', () => {
  const absolute = $('#manual-mode').value === 'absolute';
  $('#absolute-label').hidden = !absolute; $('#minutes-label').hidden = absolute;
  $('#absolute').required = absolute; $('#minutes').required = !absolute;
});
let pending = null, sending = false;
$('#manual-form').addEventListener('submit', event => {
  event.preventDefault(); if (sending) return;
  void (async () => {
    const form = { name: $('#manual-name').value, ...($('#manual-mode').value === 'minutes'
      ? { minutes: Number($('#minutes').value) } : { endAt: Date.parse($('#absolute').value + '+09:00') }) };
    if (!pending || JSON.stringify(pending.form) !== JSON.stringify(form)) pending = { form, requestId: crypto.randomUUID() };
    sending = true;
    setNotice('#manual-notice', '予約中…');
    try {
      await call('manual-create', { command: { ...pending.form, requestId: pending.requestId } });
      pending = null; $('#manual-form').reset();
      setNotice('#manual-notice', '✅ 予約しました');
      notice('予約しました');
      await loadManual();
    } catch (e) {
      setNotice('#manual-notice', '❌ 予約失敗: ' + e.message, true);
      notice('操作に失敗しました: ' + e.message);
    } finally { sending = false; }
  })();
});
void action(async () => {
  const local = await call('calculation-settings');
  $('#fatigue-target').value = local.fatigueTarget; $('#fatigue-presets').value = local.fatiguePresets.join(', ');
  const connection = await call('connection'); $('#url').value = connection.url; $('#token').value = connection.token;
  if (connection.url) { await loadSettings(); await loadManual(); }
  else notice('接続情報を登録すると、中央の通知設定と手動予約を取得できます。');
});
