const form = document.querySelector('#notification-settings');
const input = document.querySelector('#notification-advance');
const notice = document.querySelector('#notification-notice');

// 画面表示時にサーバーから最新設定を取得（ローカルストレージには保存しない）
chrome.runtime.sendMessage({ type: 'get-notification-settings' }).then(reply => {
  if (reply && Number.isInteger(reply.offsetSec)) {
    input.value = reply.offsetSec;
    const desc = reply.offsetSec < 0 ? `${Math.abs(reply.offsetSec)}秒早める設定`
      : reply.offsetSec > 0 ? `${reply.offsetSec}秒遅くする設定` : '定刻通知（調整なし）';
    notice.textContent = `現在の中央設定: ${desc}`;
  }
}).catch(() => {
  notice.textContent = '中央から設定を取得できませんでした。接続設定を確認してください。';
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  const button = form.querySelector('button'), offsetSec = Number(input.value);
  if (!input.value.trim() || !Number.isInteger(offsetSec) || offsetSec < -3600 || offsetSec > 3600) {
    notice.textContent = '-3600～3600の整数を入力してください。（マイナスで早める、プラスで遅くする）';
    return;
  }
  button.disabled = true;
  notice.textContent = '中央へ保存中…';
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'notification-settings', offsetSec });
    if (!reply || reply.error) throw new Error(reply?.error || 'connection');
    const desc = offsetSec < 0 ? `${Math.abs(offsetSec)}秒早める設定`
      : offsetSec > 0 ? `${offsetSec}秒遅くする設定` : '定刻通知（調整なし）';
    notice.textContent = `中央へ設定を保存しました（${desc}）。`;
  } catch {
    notice.textContent = '中央へ保存できませんでした。接続設定を確認してください。';
  } finally {
    button.disabled = false;
  }
});
