import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const output = new URL('.local/browser-smoke/', root);
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(fileURLToPath(new URL('profile-', output)));
const chrome = process.env.NOTIFY_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const child = spawn(chrome, ['--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
  `--user-data-dir=${profile}`, 'about:blank'],
{ windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let sequence = 0, buffer = ''; const pending = new Map(), errors = [];
child.stderr.on('data', () => {});
child.on('error', e => { for (const p of pending.values()) p.reject(e); });
child.stdio[4].on('data', chunk => {
  buffer += chunk.toString(); let pos;
  while ((pos = buffer.indexOf('\0')) >= 0) {
    const text = buffer.slice(0, pos); buffer = buffer.slice(pos + 1); if (!text) continue;
    const msg = JSON.parse(text);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); clearTimeout(p.timer); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); }
  }
});
function call(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
async function evaluate(expression, session) {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ': ' + r.exceptionDetails.exception?.description);
  return r.result.value;
}
try {
  const version = await call('Browser.getVersion');
  const extension = await call('Extensions.loadUnpacked', { path: fileURLToPath(new URL('extension/', root)) });
  const target = await call('Target.createTarget', { url: `chrome-extension://${extension.id}/panel.html` });
  const { sessionId } = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await call('Runtime.enable', {}, sessionId); await call('Page.enable', {}, sessionId);
  let text = '';
  for (let i = 0; i < 40; i++) {
    text = await evaluate('document.body?.innerText || ""', sessionId);
    if (text.includes('最初に設定画面')) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.match(text, /最初に設定画面/);
  assert.match(text, /未送信：0件/);
  const local = await evaluate('chrome.runtime.sendMessage({type:"local"})', sessionId);
  assert.equal(local.value.configured, false);
  await call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
  const screenshot = await call('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(new URL('panel.png', output), Buffer.from(screenshot.data, 'base64'));

  // Test popup.html
  const popupTarget = await call('Target.createTarget', { url: `chrome-extension://${extension.id}/popup.html` });
  const { sessionId: popupSession } = await call('Target.attachToTarget', { targetId: popupTarget.targetId, flatten: true });
  await call('Runtime.enable', {}, popupSession); await call('Page.enable', {}, popupSession);
  let fleetCards = 0;
  for (let i = 0; i < 40; i++) {
    fleetCards = await evaluate('document.querySelectorAll(".fleet-card").length', popupSession);
    if (fleetCards === 4) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(fleetCards, 4);
  await call('Emulation.setDeviceMetricsOverride', { width: 780, height: 580, deviceScaleFactor: 1, mobile: false }, popupSession);
  const popupScreenshot = await call('Page.captureScreenshot', { format: 'png' }, popupSession);
  writeFileSync(new URL('popup.png', output), Buffer.from(popupScreenshot.data, 'base64'));

  // Populate mock data and verify active fleet display
  const now = Date.now();
  await evaluate(`(async () => {
    await chrome.storage.local.set({
      config: { url: 'http://127.0.0.1:8787', token: 'mock' },
      fatigueSnapshot: {
        fleets: {
          1: { ships: [1, 2] },
          2: { ships: [3] },
          3: { ships: [4] },
          4: { ships: [5] }
        },
        ships: {
          1: { cond: 49 },
          2: { cond: 50 },
          3: { cond: 33 },
          4: { cond: 54 },
          5: { cond: 25 }
        },
        docks: [], docksKnown: true, at: ${now}, needsPort: false
      },
      fatigueSettings: { presets: [40, 49, 53], defaultTarget: 49, fleets: { 1: 49, 2: 40, 3: 53, 4: 49 } },
      remoteCache: {
        now: ${now}, cachedAt: ${now},
        slots: {
          'expedition:2': { kind: 'expedition', slot: 2, name: '海上護衛任務', state: 'active', end: ${now + 1500000} },
          'expedition:3': { kind: 'expedition', slot: 3, name: '東京急行', state: 'active', end: ${now + 3600000} },
          'expedition:4': { kind: 'expedition', slot: 4, state: 'empty', end: null },
          'repair:1': { kind: 'repair', slot: 1, name: '大和', state: 'active', end: ${now + 7200000} },
          'build:1': { kind: 'build', slot: 1, name: '長門', state: 'active', end: ${now + 14400000} },
          'build:2': { kind: 'build', slot: 2, name: '陸奥', state: 'complete', end: ${now - 1000} }
        }
      },
      akashi: [{ kind: 'akashi', slot: 1, state: 'active', repair: { start: ${now - 1200000}, ships: [
        { id: 1, name: '明石改', hp: 35, max: 37, repair: 1230000, mod: 1 },
        { id: 2, name: '吹雪改二', hp: 28, max: 36, repair: 2730000, mod: 1 }
      ] } }],
      hideBuildName: true
    });
    // Trigger storage change listener or reload
    location.reload();
  })()`, popupSession);

  await new Promise(r => setTimeout(r, 600));
  const build1Text = await evaluate('document.querySelector("#build-name-1")?.textContent', popupSession);
  const build2Text = await evaluate('document.querySelector("#build-name-2")?.textContent', popupSession);
  assert.equal(build1Text, '建造中');
  assert.equal(build2Text, '完成');

  const repairText = await evaluate('document.querySelector("#akashi-fleets").innerText', popupSession);
  assert.match(repairText, /明石改: 35->37 \+2　全回復/);
  assert.match(repairText, /吹雪改二: 28->31 \+3　あと25分/);
  assert.equal(await evaluate('!!document.querySelector(".crane-icon")', popupSession), true);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= 808', popupSession), true);
  const activeScreenshot = await call('Page.captureScreenshot', { format: 'png' }, popupSession);
  writeFileSync(new URL('popup_active.png', output), Buffer.from(activeScreenshot.data, 'base64'));

  // Test settings.html
  const settingsTarget = await call('Target.createTarget', { url: `chrome-extension://${extension.id}/settings.html` });
  const { sessionId: settingsSession } = await call('Target.attachToTarget', { targetId: settingsTarget.targetId, flatten: true });
  await call('Runtime.enable', {}, settingsSession); await call('Page.enable', {}, settingsSession);
  await new Promise(r => setTimeout(r, 600));

  // Verify hideBuildName checkbox state and toggle
  const checkState = await evaluate('document.querySelector("#hide-build-name")?.checked', settingsSession);
  assert.equal(checkState, true);

  // Toggle off in settings
  await evaluate(`(async () => {
    const cb = document.querySelector("#hide-build-name");
    cb.click();
  })()`, settingsSession);
  await new Promise(r => setTimeout(r, 300));
  const toggledHide = await evaluate('(async () => (await chrome.storage.local.get("hideBuildName")).hideBuildName)()', settingsSession);
  assert.equal(toggledHide, false);

  // Restore to true for visual artifact
  await evaluate(`(async () => {
    const cb = document.querySelector("#hide-build-name");
    cb.click();
  })()`, settingsSession);
  await new Promise(r => setTimeout(r, 300));

  await call('Emulation.setDeviceMetricsOverride', { width: 800, height: 960, deviceScaleFactor: 1, mobile: false }, settingsSession);
  const settingsScreenshot = await call('Page.captureScreenshot', { format: 'png' }, settingsSession);
  writeFileSync(new URL('settings.png', output), Buffer.from(settingsScreenshot.data, 'base64'));

  assert.deepEqual(errors, []);
  const report = { browser: version.product, extension: extension.id, loaded: true, backgroundMessaging: true, panelRendered: true, popupRendered: true, fleetCards, runtimeErrors: errors };
  writeFileSync(new URL('result.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await call('Browser.close').catch(() => {});
  child.kill();
}
