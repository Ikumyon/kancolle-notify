import { retryDelay } from './core/retry.js';
import { eventKey, eventSignature } from './core/generation.js';
import { fatigueEvents, fatigueSettings, emptyFatigueSettings, validTarget } from './core/fatigue.js';
import { localView } from './core/local.js';
let serial = Promise.resolve();
const exclusive = fn => { const next = serial.then(fn); serial = next.catch(() => {}); return next; };
const read = async () => ({ queue: [], errors: [], attempt: 0, retryPending: false, ...(await chrome.storage.local.get(null)) });
const save = patch => chrome.storage.local.set(patch);
export function endpoint(value) {
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)
    || !(url.protocol === 'https:' && url.hostname.endsWith('.workers.dev') || local && url.protocol === 'http:')) throw new Error('invalid_endpoint');
  return url.origin;
}
async function request(path, options = {}) {
  const { config } = await read();
  if (!config?.url || !config.token) throw new Error('not_configured');
  const origin = endpoint(config.url);
  // This is the only production network entry point in the extension. Never accepts game URLs.
  const response = await fetch(origin + path, { ...options, headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(15000), cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'authentication' : response.status === 400 ? 'invalid_data' : 'connection');
  const result = await response.json();
  if (result.state) result.state.cachedAt = Date.now();
  else if (Number.isFinite(result.now)) result.cachedAt = Date.now();
  return result;
}
async function error(code) {
  const s = await read();
  await save({ lastError: code, errors: [...s.errors, { code }].slice(-100) });
}
async function sendManual() {
  try { return await deliverManual(); }
  catch (e) {
    const s = await read();
    if (s.pendingManual) await save({ pendingManual: { ...s.pendingManual, sendError: e.message } });
    throw e;
  }
}
async function deliverManual() {
  const s = await read(); if (!s.pendingManual) return { ok: true };
  const { queuedAt, sendError, ...command } = s.pendingManual;
  const result = await request('/v2/manual', { method: 'POST', body: JSON.stringify(command) });
  const r = result.reservation;
  if (!r || !Number.isFinite(result.now)) throw new Error('invalid_reply');
  const recentSent = [...(s.recentSent || []), { session: s.pendingManual.id, seq: r.revision,
    queuedAt, receivedAt: result.now, epoch: null, generation: null,
    events: [{ kind: 'manual', slot: null, name: r.name, state: r.state, end: r.end, action: s.pendingManual.action }],
    errors: [], result: { status: result.status } }].slice(-50);
  const manualSlots = { ...s.manualSlots, [`manual:${s.pendingManual.id}`]: {
    kind: 'manual', slot: null, name: r.name, state: r.state, end: r.end, action: s.pendingManual.action
  } };
  await save({ pendingManual: null, manualSlots, recentSent, lastSync: result.now, remoteCache: result.state });
  return result;
}
async function flush(force = false) {
  let s = await read();
  let attempted = [];
  if (!s.queue.length || !s.config || !s.play || s.play.retired || s.blocked || s.retryPending && !force) return;
  try {
    attempted = s.queue.slice(0, 10);
    if (!s.play.ticket) {
      const result = await request('/v2/session', { method: 'POST', body: JSON.stringify({ session: s.play.session }) });
      if (!result.ticket || result.ticket.session !== s.play.session) throw new Error('invalid_reply');
      s.play.ticket = result.ticket;
      await save({ play: s.play, remoteCache: result.state });
    }
    for (let round = 0; round < 4 && s.queue.length; round++) {
      attempted = s.queue.slice(0, 10);
      const batch = attempted.map(o => ({ session: o.session, seq: o.seq, events: o.events, errors: o.errors, ...s.play.ticket }));
      const result = await request('/v2/observations', { method: 'POST', body: JSON.stringify({ observations: batch }) });
      if (!Array.isArray(result.results) || result.results.length !== batch.length
        || !result.results.every((r, i) => r.seq === batch[i].seq)) throw new Error('invalid_reply');
      if (result.results.some(r => r.status === 'stale_session')) {
        s.play.retired = true;
        const rejected = s.queue.map(o => ({ ...o, sendError: 'stale_session', receivedAt: result.now, result: { status: 'stale_session' } }));
        await save({ play: s.play, queue: [], recentSent: [...(s.recentSent || []), ...rejected].slice(-50), lastError: 'stale_session', retryPending: false, remoteCache: result.state });
        await chrome.alarms.clear('retry'); return;
      }
      for (const o of batch) for (const e of o.events) s.play.baseline[eventKey(e)] = eventSignature(e);
      const receipts = batch.map((o, i) => ({ ...o, queuedAt: attempted[i].queuedAt, receivedAt: result.now, result: result.results[i] }));
      s.recentSent = [...(s.recentSent || []), ...receipts].slice(-50);
      s.queue = s.queue.slice(batch.length);
      await save({ play: s.play, queue: s.queue, lastSync: result.now, lastResults: result.results,
        recentSent: s.recentSent, remoteCache: result.state, lastError: '', attempt: 0, retryPending: false });
    }
    await save({ attempt: 0, retryPending: false });
    if (s.queue.length) await chrome.alarms.create('retry', { delayInMinutes: 1 });
    else await chrome.alarms.clear('retry');
  } catch (e) {
    const blocked = ['authentication', 'invalid_data'].includes(e.message);
    await error(e.message);
    const failedSeqs = new Set(attempted.map(o => o.seq));
    s.queue = s.queue.map(o => failedSeqs.has(o.seq) ? { ...o, sendError: e.message } : o);
    await save({ queue: s.queue, blocked, attempt: s.attempt + 1, retryPending: !blocked });
    if (!blocked) await chrome.alarms.create('retry', { delayInMinutes: retryDelay(s.attempt + 1) / 60000 });
  }
}
async function enqueueEvents(s, incoming) {
  if (incoming.length) {
    s.localSlots = { ...(s.localSlots || s.expeditionSlots) };
    for (const e of incoming) s.localSlots[eventKey(e)] = e;
    await save({ localSlots: s.localSlots });
  }
  if (s.play.retired) return;
  const known = { ...s.play.baseline };
  for (const pending of s.queue) for (const e of pending.events) known[eventKey(e)] = eventSignature(e);
  const events = incoming.filter(e => known[eventKey(e)] !== eventSignature(e));
  if (!events.length) { if (s.queue.length) await flush(); return; }
  s.play.seq = (s.play.seq || 0) + 1;
  s.queue.push({ session: s.play.session, seq: s.play.seq, events, errors: [], queuedAt: Date.now() });
  await save({ play: s.play, queue: s.queue }); await flush();
}
async function refreshFatigue(s) {
  if (!s.play || !s.fatigueSnapshot) return;
  await enqueueEvents(s, fatigueEvents(s.fatigueSnapshot, s.fatigueSettings || emptyFatigueSettings()));
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  exclusive(async () => {
    switch (message?.type) {
      case 'begin': {
        const s = await read();
        if (s.play?.session !== message.session) {
          // 比較用の保存内容と未送信分は、DevToolsを開き直しても維持する。
          const queue = s.queue.map((o, i) => ({ ...o, session: message.session, seq: i + 1 }));
          await save({ play: { session: message.session, ticket: null, baseline: s.play?.baseline || {}, retired: false, seq: queue.length },
            queue, blocked: false, retryPending: false, attempt: 0 });
        }
        return { ok: true };
      }
      case 'enqueue': {
        let s = await read(); const o = message.observation;
        if (!o || !Number.isSafeInteger(o.seq)) throw new Error('invalid_data');
        if (s.play?.session !== o.session) return { ignored: true };
        if (o.errors?.length) await error(o.errors.join(','));
        if (message.fatigue) { s.fatigueSnapshot = message.fatigue; await save({ fatigueSnapshot: message.fatigue }); }
        const fatigue = message.fatigue ? fatigueEvents(message.fatigue, s.fatigueSettings || emptyFatigueSettings()) : [];
        if (message.akashi) await save({ akashi: message.akashi });
        await enqueueEvents(s, [...o.events, ...fatigue, ...(message.akashi || [])]);
        return { stored: true };
      }
      case 'fatigue-settings': {
        const value = fatigueSettings(message.settings);
        await save({ fatigueSettings: value }); await refreshFatigue(await read()); return value;
      }
      case 'fatigue-target': {
        const s = await read(), settings = s.fatigueSettings || emptyFatigueSettings();
        if (![1, 2, 3, 4].includes(message.fleet) || !validTarget(message.target) || !settings.presets.includes(message.target)) throw new Error('invalid_fatigue_settings');
        settings.fleets[message.fleet] = message.target;
        await save({ fatigueSettings: settings }); await refreshFatigue(await read()); return settings;
      }
      case 'collector': {
        const { collectors = {} } = await read();
        collectors[message.session] = { tab: sender.tab?.id ?? message.tab, active: message.active };
        await save({ collectors: Object.fromEntries(Object.entries(collectors).slice(-20)) }); return { ok: true };
      }
      case 'local': {
        const s = await read();
        return { ...localView(s), cache: s.remoteCache };
      }
      case 'notification-settings': {
        if (!Number.isInteger(message.advanceSec) || message.advanceSec < 0 || message.advanceSec > 3600) throw new Error('invalid_data');
        const result = await request('/v2/notification-settings', { method: 'POST', body: JSON.stringify({ advanceSec: message.advanceSec }) });
        if (result.advanceSec !== message.advanceSec) throw new Error('invalid_reply');
        await save({ notificationAdvanceSec: result.advanceSec });
        return result;
      }
      case 'manual': {
        const s = await read();
        if (s.pendingManual) throw new Error('manual_pending');
        const c = message.command;
        if (!c || !['create', 'cancel'].includes(c.action)) throw new Error('invalid_manual');
        const command = c.action === 'cancel' ? { action: 'cancel', id: c.id }
          : { action: 'create', id: crypto.randomUUID(), title: c.title, mode: c.mode, minutes: c.minutes, end: c.end };
        await save({ pendingManual: { ...command, queuedAt: Date.now() } });
        try { return await sendManual(); }
        catch (e) {
          // 400 means it was rejected, not an ambiguous network outcome.
          if (e.message === 'invalid_data') await save({ pendingManual: null });
          throw e;
        }
      }
      case 'manual-retry': {
        try { return await sendManual(); }
        catch (e) { if (e.message === 'invalid_data') await save({ pendingManual: null }); throw e; }
      }
      case 'retry': await save({ blocked: false, retryPending: false }); await flush(true); return { ok: true };
      case 'resume': { const result = await request('/v2/resume', { method: 'POST' }); await save({ remoteCache: result.state }); return result; }
      default: throw new Error('unknown_message');
    }
  }).then(value => respond({ value }), e => respond({ error: e.message || 'failure' }));
  return true;
});
async function init() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.alarms.clear('maintenance');
  const s = await read();
  if (s.protocol !== 2) {
    await chrome.storage.local.remove(['held', 'clockServerTime', 'collectors', 'lastResults', 'recentSent', 'remoteCache']);
    await save({ protocol: 2, play: null, queue: [], attempt: 0, retryPending: false, blocked: false, lastError: '' });
    await chrome.alarms.clear('retry');
  } else if (s.play && !s.play.retired && !s.blocked && s.queue.length
    && !await chrome.alarms.get('retry')) await chrome.alarms.create('retry', { delayInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(() => exclusive(init));
chrome.runtime.onStartup.addListener(() => exclusive(async () => { await init(); await save({ collectors: {} }); await flush(true); }));
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'retry') return exclusive(() => flush(true)); });
exclusive(init).catch(() => {});
