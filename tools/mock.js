const status = document.querySelector('#detection');
const buttons = {
  akashi: document.querySelector('#btn-akashi'),
  start: document.querySelector('#btn-start'),
  port: document.querySelector('#btn-port'),
  deck: document.querySelector('#btn-deck'),
  ndock: document.querySelector('#btn-ndock'),
  kdock: document.querySelector('#btn-kdock')
};
let baseline = null, instance = null, clicks = 0, extraDetected = false, stopped = false, checking = false;

function setButtonsDisabled(disabled) {
  for (const b of Object.values(buttons)) {
    if (b) b.disabled = disabled;
  }
}

async function check() {
  if (checking || stopped) return;
  checking = true;
  try {
    const response = await fetch('/mock/count', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('count_failed');
    const data = await response.json();
    if (baseline === null) {
      baseline = data.requests;
      instance = data.instance;
      setButtonsDisabled(false);
    }
    if (data.instance !== instance) {
      stopped = true;
      setButtonsDisabled(true);
      status.textContent = 'サーバーが再起動しました。ページを再読み込みして検出を開始してください。';
      return;
    }
    const actual = data.requests - baseline;
    if (actual > clicks) extraDetected = true;
    status.textContent = extraDetected ? '警告：操作回数を超えるゲームAPIリクエストを検出しました。'
      : actual < clicks ? '操作した通信の到着を確認中…' : clicks === 0 ? '検出中：いずれかの模擬ボタンを押してください。' : '検出中：余分なゲームAPIリクエストはありません。';
    status.style.color = extraDetected ? '#b00020' : '#206040';
    document.querySelector('#counts').textContent = `模擬操作：${clicks}回 ／ ゲームAPI受信：${actual}件`;
    document.querySelector('#requests').textContent = data.recent.filter(r => r.number > baseline)
      .map(r => `#${r.number} [${new Date(r.at).toLocaleTimeString()}] ${r.method} ${r.path}`).join('\n') || '（まだリクエストはありません）';
  } catch {
    status.textContent = '件数を取得できません。疑似サーバーの起動を確認してください。';
  } finally { checking = false; }
}

async function triggerApi(path, body = '') {
  setButtonsDisabled(true);
  clicks++;
  try {
    const response = await fetch(path, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000) });
    const text = await response.text();
    let pretty = text;
    try {
      const json = JSON.parse(text.replace(/^[\s\S]*?svdata=/, ''));
      pretty = JSON.stringify(json, null, 2);
    } catch {}
    document.querySelector('#output').textContent = `[${path}]\n` + pretty;
  } catch {
    document.querySelector('#output').textContent = `[${path}] 模擬通信に失敗しました。`;
  } finally {
    if (!stopped) setButtonsDisabled(false);
    await check();
  }
}

buttons.start?.addEventListener('click', () => triggerApi('/kcsapi/api_start2/getData'));
buttons.port?.addEventListener('click', () => triggerApi('/kcsapi/api_port/port'));
buttons.deck?.addEventListener('click', () => triggerApi('/kcsapi/api_get_member/deck'));
buttons.ndock?.addEventListener('click', () => triggerApi('/kcsapi/api_get_member/ndock'));
buttons.kdock?.addEventListener('click', () => triggerApi('/kcsapi/api_get_member/kdock'));

check();
setInterval(check, 2000);


buttons.akashi?.addEventListener('click', async () => {
  for (const api of ['api_start2/getData', 'api_get_member/slot_item', 'api_port/port', 'api_req_hensei/change']) {
    await triggerApi('/kcsapi/' + api + '?akashi=1', api === 'api_req_hensei/change' ? 'api_id=1&api_ship_idx=1&api_ship_id=2' : '');
  }
});
