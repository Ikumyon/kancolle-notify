import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
test('settings saves and verifies connection without permission prompts or background messages', async () => {
  const nodes = new Map(), listeners = {}, data = {};
  for (const id of ['settings', 'notice', 'saved-state', 'connection-state', 'url', 'token', 'button']) {
    nodes.set('#' + id, { value: '', textContent: '', addEventListener: (name, fn) => { listeners[name] = fn; }, querySelector: () => nodes.get('#button') });
  }
  let requests = 0;
  const context = vm.createContext({ document: { querySelector: s => nodes.get(s) }, URL, AbortController, Number, setTimeout, clearTimeout,
    chrome: { runtime: {}, storage: { local: {
      get: (_keys, callback) => callback(structuredClone(data)),
      set: (patch, callback) => { Object.assign(data, structuredClone(patch)); callback(); }
    } } },
    fetch: async (url, options) => { requests++; assert.equal(url, 'http://127.0.0.1:8787/v2/status'); assert.equal(options.redirect, 'error'); return Response.json({ now: 1800000000000, slots: {}, history: [] }); }
  });
  vm.runInContext(readFileSync(new URL('../extension/settings.js', import.meta.url), 'utf8'), context);
  await new Promise(r => setImmediate(r));
  nodes.get('#url').value = 'http://127.0.0.1:8787'; nodes.get('#token').value = 'A'.repeat(43);
  await listeners.submit({ preventDefault() {} });
  assert.equal(data.config.url, 'http://127.0.0.1:8787');
  assert.match(nodes.get('#saved-state').textContent, /保存済み/);
  assert.equal(nodes.get('#connection-state').textContent, '接続：成功');
  assert.equal(nodes.get('#button').disabled, false); assert.equal(requests, 1);
});
test('test mode toggles local mock server URL and preserves production configuration', async () => {
  const nodes = new Map(), listeners = {}, data = {
    config: { url: 'https://kancolle-notify.my-account.workers.dev', token: 'P'.repeat(43) }
  };
  for (const id of ['settings', 'notice', 'saved-state', 'connection-state', 'url', 'token', 'button', 'test-mode', 'test-mode-box']) {
    nodes.set('#' + id, { value: '', textContent: '', checked: false, disabled: false, classList: { toggle() {} }, addEventListener: (name, fn) => { listeners[name] = fn; }, querySelector: () => nodes.get('#button') });
  }
  let requests = 0;
  const context = vm.createContext({ document: { querySelector: s => nodes.get(s) }, URL, AbortController, Number, setTimeout, clearTimeout,
    chrome: { runtime: {}, storage: { local: {
      get: (_keys, callback) => callback(structuredClone(data)),
      set: (patch, callback) => { Object.assign(data, structuredClone(patch)); callback(); }
    } } },
    fetch: async (url) => { requests++; return Response.json({ now: 1800000000000, slots: {}, history: [] }); }
  });
  vm.runInContext(readFileSync(new URL('../extension/settings.js', import.meta.url), 'utf8'), context);
  await new Promise(r => setImmediate(r));
  assert.equal(nodes.get('#url').value, 'https://kancolle-notify.my-account.workers.dev');

  // Turn test mode ON
  nodes.get('#test-mode').checked = true;
  await listeners.change();
  assert.equal(data.testMode, true);
  assert.equal(data.config.url, 'http://127.0.0.1:8787');
  assert.equal(data.productionConfig.url, 'https://kancolle-notify.my-account.workers.dev');
  assert.equal(nodes.get('#url').disabled, true);

  // Turn test mode OFF -> restores production config
  nodes.get('#test-mode').checked = false;
  await listeners.change();
  assert.equal(data.testMode, false);
  assert.equal(data.config.url, 'https://kancolle-notify.my-account.workers.dev');
  assert.equal(nodes.get('#url').disabled, false);
  assert.equal(nodes.get('#url').value, 'https://kancolle-notify.my-account.workers.dev');
});

test('hideBuildName toggles and persists in storage', async () => {
  const nodes = new Map(), listeners = {}, data = { hideBuildName: false };
  for (const id of ['settings', 'notice', 'saved-state', 'connection-state', 'url', 'token', 'button', 'test-mode', 'test-mode-box', 'hide-build-name', 'display-notice']) {
    nodes.set('#' + id, { value: '', textContent: '', checked: false, disabled: false, classList: { toggle() {} }, addEventListener: (name, fn) => { listeners[id + ':' + name] = fn; }, querySelector: () => nodes.get('#button') });
  }
  const context = vm.createContext({ document: { querySelector: s => nodes.get(s) }, URL, AbortController, Number, setTimeout, clearTimeout,
    chrome: { runtime: {}, storage: { local: {
      get: (_keys, callback) => callback(structuredClone(data)),
      set: (patch, callback) => { Object.assign(data, structuredClone(patch)); callback(); }
    } } },
    fetch: async () => Response.json({ now: 1800000000000, slots: {}, history: [] })
  });
  vm.runInContext(readFileSync(new URL('../extension/settings.js', import.meta.url), 'utf8'), context);
  await new Promise(r => setImmediate(r));
  assert.equal(nodes.get('#hide-build-name').checked, false);

  // Turn hideBuildName ON
  nodes.get('#hide-build-name').checked = true;
  await listeners['hide-build-name:change']();
  assert.equal(data.hideBuildName, true);
  assert.match(nodes.get('#display-notice').textContent, /隠すように設定しました/);

  // Turn hideBuildName OFF
  nodes.get('#hide-build-name').checked = false;
  await listeners['hide-build-name:change']();
  assert.equal(data.hideBuildName, false);
  assert.match(nodes.get('#display-notice').textContent, /表示するように設定しました/);
});


