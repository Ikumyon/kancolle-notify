const form = document.querySelector('#settings'), notice = document.querySelector('#notice');
const button = form.querySelector('button'), saved = document.querySelector('#saved-state'), connection = document.querySelector('#connection-state');
const testModeCheck = document.querySelector('#test-mode'), testModeBox = document.querySelector('#test-mode-box');
const urlInput = document.querySelector('#url'), tokenInput = document.querySelector('#token');

const TEST_URL = 'http://127.0.0.1:8787';
const TEST_TOKEN = 'test-mode-fixed-token-for-dev-server-only-12345';

function storage(method, value) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('設定保存領域から応答がありません。拡張を再読み込みしてください。')), 5000);
    try {
      chrome.storage.local[method](value, result => {
        clearTimeout(timer);
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message)); else resolve(result);
      });
    } catch (e) { clearTimeout(timer); reject(e); }
  });
}

function updateUiForMode(isTest, config, productionConfig) {
  testModeCheck.checked = isTest;
  testModeBox?.classList.toggle('active', isTest);
  if (isTest) {
    urlInput.value = TEST_URL;
    urlInput.disabled = true;
    tokenInput.value = '';
    tokenInput.placeholder = 'テスト用固定トークンを使用中';
    tokenInput.disabled = true;
    tokenInput.required = false;
    button.disabled = true;
    saved.textContent = `保存済み：${TEST_URL}（テストモード・固定接続）`;
    saved.className = 'good';
  } else {
    urlInput.value = config?.url || productionConfig?.url || '';
    urlInput.disabled = false;
    tokenInput.placeholder = '';
    tokenInput.disabled = false;
    tokenInput.required = true;
    button.disabled = false;
    button.textContent = '保存して接続';
    saved.textContent = config ? `保存済み：${config.url}（トークン登録済み）` : '未保存';
    saved.className = config ? 'good' : '';
  }
}

const hideBuildNameCheck = document.querySelector('#hide-build-name');
const displayNotice = document.querySelector('#display-notice');

storage('get', ['config', 'productionConfig', 'testMode', 'hideBuildName']).then(r => {
  const isTest = r.testMode === true || r.config?.url === TEST_URL;
  updateUiForMode(isTest, r.config, r.productionConfig);
  if (hideBuildNameCheck) {
    hideBuildNameCheck.checked = !!r.hideBuildName;
  }
  if (isTest) testConnection(TEST_URL, TEST_TOKEN);
}).catch(e => { saved.textContent = '保存状態を確認できません'; notice.textContent = e.message; });

hideBuildNameCheck?.addEventListener('change', async () => {
  const hide = hideBuildNameCheck.checked;
  try {
    await storage('set', { hideBuildName: hide });
    if (displayNotice) {
      displayNotice.textContent = hide ? '建造中の艦名を隠すように設定しました。' : '建造中の艦名を表示するように設定しました。';
      setTimeout(() => { if (displayNotice.textContent.includes('設定しました')) displayNotice.textContent = ''; }, 3000);
    }
  } catch (e) {
    if (displayNotice) {
      displayNotice.className = 'error';
      displayNotice.textContent = `保存失敗：${e.message}`;
    }
  }
});

async function testConnection(url, token) {
  connection.textContent = '接続：確認中…';
  connection.className = '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url + '/v2/status', {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal, redirect: 'error', cache: 'no-store', credentials: 'omit'
    });
    if (response.status === 401) throw new Error('トークンが一致しません。');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const check = await response.json();
    if (!Number.isFinite(check.now) || !check.slots) throw new Error('中央の応答形式が正しくありません。');
    await storage('set', { remoteCache: { ...check, cachedAt: Date.now() } });
    connection.textContent = '接続：成功';
    connection.className = 'good';
    return true;
  } catch (e) {
    connection.textContent = `接続：失敗（${e.message}）`;
    connection.className = 'error';
    return false;
  } finally { clearTimeout(timeout); }
}

testModeCheck?.addEventListener('change', async () => {
  const isTest = testModeCheck.checked;
  notice.textContent = isTest ? 'テストモードへ切り替え中…' : '通常モードへ復元中…';
  try {
    const current = await storage('get', ['config', 'productionConfig']);
    if (isTest) {
      const prod = (current.config && current.config.url !== TEST_URL) ? current.config : current.productionConfig;
      await storage('set', {
        testMode: true,
        productionConfig: prod || null,
        config: { url: TEST_URL, token: TEST_TOKEN },
        blocked: false, retryPending: false, attempt: 0, lastError: ''
      });
      updateUiForMode(true, { url: TEST_URL, token: TEST_TOKEN }, prod);
      notice.textContent = 'テストモードに切り替えました。接続先をローカル疑似環境（127.0.0.1:8787）に固定しました。';
      await testConnection(TEST_URL, TEST_TOKEN);
    } else {
      const restored = current.productionConfig || null;
      await storage('set', {
        testMode: false,
        config: restored,
        blocked: false, retryPending: false, attempt: 0, lastError: ''
      });
      updateUiForMode(false, restored, null);
      connection.textContent = '接続：未確認（通常モードに復帰）';
      connection.className = '';
      notice.textContent = '通常モード（本番設定）に復帰しました。';
    }
  } catch (e) {
    notice.textContent = `切り替えエラー：${e.message}`;
  }
});

form.addEventListener('invalid', () => { notice.textContent = 'URLと32文字以上の接続トークンを入力してください。'; }, true);
form.addEventListener('input', () => { button.textContent = '保存して接続'; });
form.addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true; button.textContent = '保存中…'; notice.textContent = '設定を保存しています…';
  let persisted = false;
  try {
    const url = new URL(urlInput.value.trim());
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (!(url.protocol === 'https:' && url.hostname.endsWith('.workers.dev') || url.protocol === 'http:' && local)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('WorkersのURL、またはローカル検証用URLを入力してください。');
    const token = tokenInput.value.trim();
    if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) throw new Error('接続トークンの形式を確認してください。');
    const config = { url: url.origin, token };
    await storage('set', { config, productionConfig: config, testMode: false, blocked: false, retryPending: false, attempt: 0, lastError: '' });
    const stored = await storage('get', ['config']);
    if (stored?.config?.url !== url.origin || stored.config.token !== token) throw new Error('保存結果を確認できません');
    persisted = true;
    saved.textContent = `保存済み：${stored.config.url}（トークン登録済み）`; saved.className = 'good';
    button.textContent = '保存済み'; notice.textContent = '設定を保存しました。';
    tokenInput.value = '';
    const ok = await testConnection(url.origin, token);
    if (!ok) throw new Error('接続テストに失敗しました。');
  } catch (e) {
    notice.textContent = `${persisted ? '設定は保存済みですが接続に失敗しました' : '保存できませんでした'}：${e.message}`;
    button.textContent = persisted ? '保存済み' : '保存して接続';
  } finally { button.disabled = false; }
});
