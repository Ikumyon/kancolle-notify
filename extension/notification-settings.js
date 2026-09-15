const form = document.querySelector('#notification-settings');
const input = document.querySelector('#notification-advance');
const notice = document.querySelector('#notification-notice');
chrome.storage.local.get('notificationAdvanceSec').then(s => {
  if (Number.isInteger(s.notificationAdvanceSec)) input.value = s.notificationAdvanceSec;
}).catch(() => { notice.textContent = '端末に保存した設定を読み取れませんでした。'; });
form.addEventListener('submit', async e => {
  e.preventDefault();
  const button = form.querySelector('button'), advanceSec = Number(input.value);
  if (!input.value.trim() || !Number.isInteger(advanceSec) || advanceSec < 0 || advanceSec > 3600) {
    notice.textContent = '0～3600の整数を入力してください。'; return;
  }
  button.disabled = true; notice.textContent = '中央へ保存中…';
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'notification-settings', advanceSec });
    if (!reply || reply.error) throw new Error(reply?.error || 'connection');
    notice.textContent = `${advanceSec}秒早める設定を中央へ保存しました。`;
  } catch {
    notice.textContent = '中央へ保存できませんでした。接続設定を確認してください。';
  } finally { button.disabled = false; }
});
