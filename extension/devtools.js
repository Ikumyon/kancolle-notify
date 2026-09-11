import { Parser, apiName, parameters, supported } from './core/parser.js';
const parser = new Parser();
let session = crypto.randomUUID(), started = false;
let sequence = 0, chain = Promise.resolve();
const initiated = new Set();
async function message(value) {
  const response = await chrome.runtime.sendMessage(value);
  if (response?.error) throw new Error(response.error);
  return response?.value;
}
const ready = chrome.storage.local.get(['shipNames', 'shipMasters', 'missionNames', 'fatigueMasters', 'akashiMasters', 'akashiGearMasters', 'hideBuildName']).then(cache => {
  parser.names = new Map(cache.shipNames || []); parser.ships = new Map(cache.shipMasters || []);
  if (cache.missionNames?.length) parser.missions = new Map([...parser.missions, ...cache.missionNames]);
  parser.fatigue.masters = cache.fatigueMasters || {};
  parser.akashi.masters = cache.akashiMasters || {}; parser.akashi.gearMasters = cache.akashiGearMasters || {};
  parser.hideBuildName = cache.hideBuildName ?? true;
});
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === 'local' && 'hideBuildName' in changes) {
    parser.hideBuildName = !!changes.hideBuildName.newValue;
  }
});
function getBody(request) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('body_timeout')); } }, 10000);
    const done = (body, encoding) => {
      if (settled) return; settled = true; clearTimeout(timer);
      try {
        if (encoding === 'base64') body = new TextDecoder().decode(Uint8Array.from(atob(body), c => c.charCodeAt(0)));
        if (typeof body !== 'string') throw new Error('body_missing');
        resolve(body);
      } catch { reject(new Error('body_missing')); }
    };
    try { request.getContent(done); } catch { clearTimeout(timer); reject(new Error('body_missing')); }
  });
}
chrome.devtools.network.onRequestFinished.addListener(request => {
  const api = apiName(request.request.url);
  if (!supported(api)) return;
  // Start a new generation at game startup; attaching mid-play starts at the first supported response.
  if (['api_start2', 'api_start2/getData'].includes(api) && started) { session = crypto.randomUUID(); sequence = 0; }
  const playSession = session, seq = ++sequence;
  started = true;
  const content = getBody(request).then(body => ({ body }), () => ({ error: 'body_missing' }));
  const params = parameters(request.request);
  chain = chain.catch(() => {}).then(async () => {
    await ready;
    const result = await content;
    const date = request.response.headers?.find(h => h.name.toLowerCase() === 'date')?.value;
    const parsed = result.error ? { events: [], errors: [result.error] } : parser.parse(api, result.body, params, request.response.status, date ? Date.parse(date) : null);
    if (!initiated.has(playSession) && !parsed.errors.length) {
      await message({ type: 'begin', session: playSession }); initiated.add(playSession);
    }
    if (parsed.events.length || parsed.errors.length || parsed.fatigue) {
      await message({ type: 'enqueue', observation: { session: playSession, seq, events: parsed.events, errors: parsed.errors }, fatigue: parsed.fatigue, akashi: parsed.akashi });
    }
    await chrome.storage.local.set({ shipNames: [...parser.names], shipMasters: [...parser.ships], missionNames: [...parser.missions], fatigueMasters: parser.fatigue.masters, akashiMasters: parser.akashi.masters, akashiGearMasters: parser.akashi.gearMasters });
  }).catch(() => message({ type: 'collector', session, tab: chrome.devtools.inspectedWindow.tabId, active: 'error' }).catch(() => {}));
});
chrome.devtools.panels.create('予定通知', '', 'panel.html');
message({ type: 'collector', session, tab: chrome.devtools.inspectedWindow.tabId, active: true }).catch(() => {});
window.addEventListener('unload', () => {
  chrome.runtime.sendMessage({ type: 'collector', session, tab: chrome.devtools.inspectedWindow.tabId, active: false }).catch(() => {});
});
