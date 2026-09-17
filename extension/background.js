import { extract } from './core/parser.js';
import { retryDelay } from './core/retry.js';
import { targetFor, portSupplyStatus } from './core/recovery.js';
import { calculationState, calculate, recompute, timerUpdates } from './core/timers.js';
import { defaultCalculationSettings, calculationSettings } from './core/calculation-settings.js';
export function endpoint(value) {
  const url = new URL(value), local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname) ||
    !(url.protocol === 'https:' && url.hostname.endsWith('.workers.dev') || local && url.protocol === 'http:')) throw new Error('invalid_endpoint');
  return url.origin;
}
const emptyView = () => ({ timers: {}, updates: [], receipts: {}, observedAt: null, collector: false, error: '', hideBuildName: true });
const isValidQueueItem = item =>
  Boolean(item && typeof item === 'object' && typeof item.sourceId === 'string' &&
    Number.isSafeInteger(item.sequence) && Array.isArray(item.timers));
export function hasTimerChanged(last, current) {
  if (!last) return true;
  if (last.state !== current.state) return true;
  if (last.endAt !== current.endAt) return true;
  if (last.startAt !== current.startAt) return true;
  if (last.name !== current.name) return true;
  const lastEvents = last.events || [];
  const currEvents = current.events || [];
  if (lastEvents.length !== currEvents.length) return true;
  for (let i = 0; i < currEvents.length; i++) {
    const e1 = lastEvents[i], e2 = currEvents[i];
    if (e1.id !== e2.id || e1.phase !== e2.phase || e1.endAt !== e2.endAt) return true;
  }
  return false;
}
export class ObservationBridge {
  constructor({ storage, fetch: send = (...args) => globalThis.fetch(...args), alarm, broadcast = () => {} }) {
    this.storage = storage; this.send = send; this.alarm = alarm; this.broadcast = broadcast;
    this.view = emptyView(); this.settingsCache = null; this.clock = null; this.lastSyncedTimers = {};
    this.settingsSerial = Promise.resolve(); this.serial = Promise.resolve(); this.flushing = false;
    const loadStorage = () => new Promise(resolve => {
      try {
        const p = storage.get(['connection', 'outbound', 'transport', 'calculationSettings', 'cachedView', 'cachedGame', 'cachedTimers', 'cachedClock', 'lastSyncedTimers'], s => resolve(s || {}));
        if (p && typeof p.then === 'function') p.then(resolve).catch(() => resolve({}));
      } catch { resolve({}); }
    });
    this.ready = loadStorage().then(s => {
      this.connection = s.connection || null;
      this.queue = [];
      this.transport = s.transport || { sources: {}, attempt: 0, blocked: false, events: {}, currentSource: null };
      if (!this.transport.sources || typeof this.transport.sources !== 'object') this.transport.sources = {};
      this.transport.attempt = 0;
      this.transport.blocked = false;
      for (const src of Object.values(this.transport.sources)) {
        src.sessionId = null;
        src.sequence = 0;
      }
      this.calculationSettings = calculationSettings(defaultCalculationSettings(), s.calculationSettings || {});
      this.model = calculationState(this.calculationSettings, this.transport.events);
      this.game = this.model.game;

      // ローカルストレージから前回の観測・タイマー状態を即時復元（リクエスト0回）
      if (s.cachedView && typeof s.cachedView === 'object') {
        this.view = { ...emptyView(), ...s.cachedView, collector: false, error: '' };
      }
      if (s.cachedGame && typeof s.cachedGame === 'object') {
        Object.assign(this.game, s.cachedGame);
      }
      if (s.cachedTimers && typeof s.cachedTimers === 'object') {
        this.model.timers = { ...s.cachedTimers };
      }
      if (s.cachedClock && typeof s.cachedClock === 'object') {
        this.clock = s.cachedClock;
      }
      if (s.lastSyncedTimers && typeof s.lastSyncedTimers === 'object') {
        this.lastSyncedTimers = { ...s.lastSyncedTimers };
      }
    });
  }
  async exclusive(fn) {
    const next = this.serial.then(() => this.ready).then(fn);
    this.serial = next.catch(() => {}); return next;
  }
  async persist() {
    await this.storage.set({
      connection: this.connection,
      outbound: this.queue,
      transport: this.transport,
      calculationSettings: this.calculationSettings,
      cachedView: this.view,
      cachedGame: {
        fleets: this.game.fleets,
        repair: this.game.repair,
        build: this.game.build,
        shipMasters: this.game.shipMasters,
        missionMasters: this.game.missionMasters,
        akashiAt: this.game.akashiAt,
        portSupplyAt: this.game.portSupplyAt,
        portReady: this.game.portReady
      },
      cachedTimers: this.model.timers,
      cachedClock: this.clock,
      lastSyncedTimers: this.lastSyncedTimers
    });
  }
  changed() { this.broadcast(); }
  async request(path, options = {}) {
    if (!this.connection) throw new Error('not_configured');
    const response = await this.send(endpoint(this.connection.url) + path, {
      ...options, headers: { Authorization: 'Bearer ' + this.connection.token, 'Content-Type': 'application/json' },
      redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error([401, 403].includes(response.status) ? 'authentication' : [400, 413, 404].includes(response.status) ? 'invalid_data' : 'connection');
    return response.json();
  }
  receipt(id, status, extra = {}) {
    if (this.view.receipts[id]) Object.assign(this.view.receipts[id], { status }, extra);
    this.changed();
  }
  source(id) {
    if (!this.transport.sources[id]) this.transport.sources[id] = { requestId: id, sessionId: null, sequence: 0 };
    return this.transport.sources[id];
  }
  async queueTimers(sourceId, reason, observedAt, timers, displayTimers = timers) {
    for (const timer of displayTimers) {
      this.view.timers[timer.id] = { data: structuredClone(timer), observationId: this.view.observedAt ? sourceId + ':view' : '' };
    }
    this.changed();
    if (!timers.length) { await this.persist(); return; }
    if (reason === 'observation') {
      this.transport.blocked = false;
      this.transport.attempt = 0;
    }
    const source = this.source(sourceId), sequence = ++source.sequence, id = sourceId + ':' + sequence;
    const item = { sourceId, sequence, observedAt, reason, timers };
    this.view.receipts[id] = { status: 'queued', observedAt, reason };
    for (const timer of timers) this.view.timers[timer.id] = { data: structuredClone(timer), observationId: id };
    this.view.updates.unshift({ ...structuredClone(item), observationId: id });
    this.view.updates = this.view.updates.slice(0, 30);
    const used = new Set([...Object.values(this.view.timers).map(t => t.observationId), ...this.view.updates.map(u => u.observationId)]);
    for (const key of Object.keys(this.view.receipts)) if (!used.has(key)) delete this.view.receipts[key];
    this.changed();
    if (source.retired) { this.receipt(id, 'stopped', { error: 'stale_session' }); return; }
    this.queue.push(item);
    try { await this.persist(); await this.alarm.create('retry', { delayInMinutes: 1 }); }
    catch { this.receipt(id, 'stopped', { error: 'storage' }); throw new Error('storage'); }
  }
  async enqueue(input) {
    await this.exclusive(async () => {
      const clean = extract(input.api, input.response, input.request);
      if (typeof input.sourceId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(input.sourceId) || !Number.isSafeInteger(input.observedAt)) throw new Error('invalid_observation');
      if (this.transport.currentSource !== input.sourceId) {
        this.view = { ...emptyView(), collector: this.view.collector, hideBuildName: this.view.hideBuildName };
        this.model = calculationState(this.calculationSettings, this.transport.events); this.game = this.model.game; this.clock = null;
      }
      this.transport.currentSource = input.sourceId; this.source(input.sourceId);
      const observation = { ...input, ...clean };
      calculate(this.model, observation);
      if (input.responseDate) this.clock = { serverAt: input.responseDate, clientAt: input.observedAt };
      this.view.observedAt = input.observedAt;
      const allTimers = await timerUpdates(this.model);
      const diffTimers = allTimers.filter(t => hasTimerChanged(this.lastSyncedTimers[t.id], t));
      await this.queueTimers(input.sourceId, 'observation', input.observedAt, diffTimers, allTimers);
    });
    void this.flush(); return { ok: true };
  }
  async localSettings(patch) {
    if (patch === undefined) { await this.ready; return structuredClone(this.calculationSettings); }
    await this.exclusive(async () => {
      this.calculationSettings = calculationSettings(this.calculationSettings, patch); this.model.settings = this.calculationSettings;
      await this.persist();
      // プリセットの並び替えだけでは予約を変更しない。
      if (Object.hasOwn(patch, 'fatigueTarget') || Object.hasOwn(patch, 'fatigueTargets')) {
        recompute(this.model, Date.now(), true);
        const sourceId = this.transport.currentSource || (this.transport.currentSource = crypto.randomUUID());
        const affected = Object.hasOwn(patch, 'fatigueTarget') ? [1, 2, 3, 4] : Object.keys(patch.fatigueTargets).map(Number);
        const updates = await timerUpdates(this.model, 'settings', true);
        const affectedUpdates = updates.filter(t => affected.includes(t.slot));
        const diffTimers = affectedUpdates.filter(t => hasTimerChanged(this.lastSyncedTimers[t.id], t));
        await this.queueTimers(sourceId, 'settings', this.view.observedAt, diffTimers, affectedUpdates);
      } else { this.changed(); }
      if (this.connection) {
        void this.request('/api/settings', { method: 'PATCH', body: JSON.stringify({ calculation: this.calculationSettings }) }).catch(() => {});
      }
    });
    void this.flush(); return structuredClone(this.calculationSettings);
  }
  async flush() {
    await this.ready;
    if (this.flushing || this.transport.blocked || !this.connection || !this.queue.length) return;
    this.flushing = true;
    let attempted = [];
    try {
      await this.alarm.create('retry', { delayInMinutes: 1 });
      // ネットワーク待ち中もenqueueと画面更新は継続できる。
      for (let round = 0; round < 4 && this.queue.length; round++) {
        while (this.queue.length && !isValidQueueItem(this.queue[0])) {
          const bad = this.queue.shift();
          if (bad?.sourceId && bad?.sequence) this.receipt(bad.sourceId + ':' + bad.sequence, 'stopped', { error: 'invalid_queue_item' });
        }
        if (!this.queue.length) break;

        const first = this.queue[0], source = this.source(first.sourceId);
        attempted = [];
        for (const item of this.queue) { if (item.sourceId !== first.sourceId || attempted.length === 10) break; attempted.push(item); }
        if (!source.sessionId) {
          const result = await this.request('/api/session', { method: 'POST', body: JSON.stringify({ requestId: source.requestId }) });
          if (typeof result.sessionId !== 'string') throw new Error('invalid_reply');
          await this.exclusive(async () => { source.sessionId = result.sessionId; await this.persist(); });
        }
        const updates = [];
        for (const { sourceId, ...item } of attempted) {
          const candidate = { sessionId: source.sessionId, ...item };
          if (new TextEncoder().encode(JSON.stringify({ updates: [...updates, candidate] })).byteLength > 2097152) {
            if (!updates.length) throw new Error('invalid_data');
            break;
          }
          updates.push(candidate);
        }
        attempted = attempted.slice(0, updates.length);
        for (const item of attempted) this.receipt(item.sourceId + ':' + item.sequence, 'sending');
        const result = await this.request('/api/timers', { method: 'POST', body: JSON.stringify({ updates }) });
        if (!Array.isArray(result.results) || result.results.length !== attempted.length || result.results.some((r, i) =>
          r.sequence !== attempted[i].sequence || !Number.isSafeInteger(r.receivedAt) || !['accepted', 'duplicate', 'stale_session', 'sequence_gap'].includes(r.status))) throw new Error('invalid_reply');
        await this.exclusive(async () => {
          for (let i = 0; i < attempted.length; i++) {
            const item = attempted[i], receipt = result.results[i], id = item.sourceId + ':' + item.sequence;
            if (['accepted', 'duplicate'].includes(receipt.status)) {
              for (const t of item.timers) {
                this.lastSyncedTimers[t.id] = structuredClone(t);
              }
              this.queue = this.queue.filter(q => !(q.sourceId === item.sourceId && q.sequence === item.sequence));
              this.receipt(id, 'sent', { receivedAt: receipt.receivedAt });
            } else {
              if (receipt.status === 'stale_session') {
                source.retired = true;
                for (const q of this.queue.filter(q => q.sourceId === item.sourceId)) this.receipt(q.sourceId + ':' + q.sequence, 'stopped', { error: 'stale_session' });
                this.queue = this.queue.filter(q => q.sourceId !== item.sourceId);
              } else if (receipt.status === 'sequence_gap') {
                source.sessionId = null;
                source.sequence = 0;
                for (const q of this.queue.filter(q => q.sourceId === item.sourceId)) this.receipt(q.sourceId + ':' + q.sequence, 'stopped', { error: 'sequence_gap' });
                this.queue = this.queue.filter(q => q.sourceId !== item.sourceId);
                this.transport.blocked = false;
              } else this.transport.blocked = true;
              this.receipt(id, 'stopped', { error: receipt.status });
            }
          }
          this.transport.attempt = 0; await this.persist();
        });
        if (this.transport.blocked) break;
      }
      if (this.queue.length && !this.transport.blocked) await this.alarm.create('retry', { delayInMinutes: 1 });
      else await this.alarm.clear('retry');
    } catch (e) {
      await this.exclusive(async () => {
        this.transport.blocked = ['authentication', 'invalid_data'].includes(e.message);
        this.transport.attempt++;
        for (const item of attempted) this.receipt(item.sourceId + ':' + item.sequence, this.transport.blocked ? 'stopped' : 'retry', { error: e.message });

        // 3回以上連続で失敗、または致命的エラーでブロックされた場合は古いキューを諦めてクリア
        if (this.transport.attempt >= 3 || this.transport.blocked) {
          for (const item of this.queue) {
            this.receipt(item.sourceId + ':' + item.sequence, 'stopped', { error: e.message || 'abandoned' });
          }
          this.queue = [];
          for (const src of Object.values(this.transport.sources)) src.sessionId = null;
          this.transport.attempt = 0;
          this.transport.blocked = false;
        }
        await this.persist();
      });
      if (!this.transport.blocked && this.queue.length) {
        await this.alarm.create('retry', { delayInMinutes: retryDelay(this.transport.attempt) / 60000 });
      } else {
        await this.alarm.clear('retry');
      }
    } finally { this.flushing = false; }
  }
  async settings(patch) {
    const next = this.settingsSerial.then(async () => {
      const settings = await this.request('/api/settings', patch ? { method: 'PATCH', body: JSON.stringify(patch) } : {});
      if (!settings || typeof settings.hideBuildName !== 'boolean') throw new Error('invalid_reply');
      this.settingsCache = settings; this.view.hideBuildName = settings.hideBuildName !== false;
      if (settings.calculation) {
        this.calculationSettings = calculationSettings(defaultCalculationSettings(), settings.calculation);
        this.model.settings = this.calculationSettings;
        await this.persist();
      }
      this.changed(); return settings;
    });
    this.settingsSerial = next.catch(() => {}); return next;
  }
  async syncCloudState() {
    if (!this.connection) return;
    try {
      await this.settings();
      const status = await this.request('/api/status');
      if (Array.isArray(status.timers)) {
        for (const t of status.timers) {
          if (t?.id) this.lastSyncedTimers[t.id] = structuredClone(t);
          if (t.state === 'active' && Number.isSafeInteger(t.startAt)) {
            if (t.kind === 'akashi' && !this.game.akashiAt[t.slot]) {
              this.game.akashiAt[t.slot] = t.startAt;
            }
            if (t.kind === 'fatigue' && !this.game.portSupplyAt[t.slot]) {
              this.game.portSupplyAt[t.slot] = t.startAt;
            }
          }
        }
      }
    } catch {}
  }
  async handle(message) {
    await this.ready;
    if (message.type === 'enqueue') return this.enqueue(message.observation);
    if (message.type === 'calculation-settings') return this.localSettings(message.patch);
    if (message.type === 'view') return this.publicView();
    if (message.type === 'popup') return this.popup();
    if (message.type === 'collector') { this.view.collector = message.active; this.view.error = message.error || ''; this.changed(); return { ok: true }; }
    if (message.type === 'connection') return this.connection || { url: '', token: '' };
    if (message.type === 'configure') {
      if (!/^[A-Za-z0-9_-]{32,200}$/.test(message.token)) throw new Error('invalid_token');
      await this.exclusive(async () => {
        const url = endpoint(message.url);
        if (this.connection && (this.connection.url !== url || this.connection.token !== message.token)) {
          for (const src of Object.values(this.transport.sources)) src.sessionId = null;
        }
        this.queue = this.queue.filter(isValidQueueItem);
        this.connection = { url, token: message.token }; this.transport.blocked = false; this.transport.attempt = 0; this.view.hideBuildName = true; this.settingsCache = null; await this.persist();
        this.changed();
      });
      void this.flush(); return { ok: true };
    }
    if (message.type === 'settings') return this.settings(message.patch);
    if (message.type === 'sync') return this.syncCloudState();
    if (message.type === 'manual-list') return this.request('/api/manual');
    if (message.type === 'manual-create') return this.request('/api/manual', { method: 'POST', body: JSON.stringify(message.command) });
    if (message.type === 'manual-cancel') return this.request('/api/manual/' + encodeURIComponent(message.id), { method: 'DELETE' });
    if (message.type === 'retry') {
      await this.exclusive(async () => {
        this.transport.blocked = false;
        this.transport.attempt = 0;
        this.queue = [];
        for (const src of Object.values(this.transport.sources)) {
          src.sessionId = null;
          src.sequence = 0;
        }
        await this.persist();
      });
      void this.flush(); return { ok: true };
    }
    throw new Error('unknown_command');
  }
  popup() {
    const now = this.clock ? this.clock.serverAt + Math.max(0, Date.now() - this.clock.clientAt) : Date.now();
    const shipName = id => this.game.shipMasters[this.game.ships[id]?.api_ship_id]?.api_name || '艦ID ' + id;
    const fleets = [1, 2, 3, 4].map(slot => {
      const f = this.game.fleets[slot], ids = f?.api_ship?.filter(id => id > 0) || [];
      const conds = ids.map(id => this.game.ships[id]?.api_cond);
      const target = targetFor(this.calculationSettings, slot);
      return { slot, minCond: conds.length && conds.every(Number.isInteger) ? Math.min(...conds) : null,
        name: f?.api_name || '', mission: f?.api_mission || null,
        missionName: this.game.missionMasters[f?.api_mission?.[1]]?.api_name || (f?.api_mission?.[1] ? '遠征ID ' + f.api_mission[1] : ''),
        fatigue: this.model.timers['fatigue:' + slot] || { state: 'pending', endAt: null, detail: { reason: '未観測' } }, target,
        portSupply: portSupplyStatus(this.game, f),
        ships: ids.map(id => ({ name: shipName(id), hp: this.game.ships[id]?.api_nowhp, maxHp: this.game.ships[id]?.api_maxhp })) };
    });
    const docks = kind => [1, 2, 3, 4].map(slot => {
      const d = this.game[kind][slot], timer = this.model.timers[kind + ':' + slot];
      return { slot, state: d?.api_state ?? null, endAt: timer?.endAt ?? null,
        name: kind === 'repair' ? d?.api_ship_id ? shipName(d.api_ship_id) : ''
          : this.view.hideBuildName ? '建造艦名非表示' : this.game.shipMasters[d?.api_created_ship_id]?.api_name || '建造中' };
    });
    return { configured: Boolean(this.connection?.url && this.connection?.token),
      observedAt: this.view.observedAt, now, collector: this.view.collector, error: this.view.error,
      settings: this.calculationSettings, fleets, repair: docks('repair'), build: docks('build'),
      akashi: [1, 2].map(slot => ({ slot, ...(this.model.timers['akashi:' + slot] || { state: 'pending', endAt: null, detail: { reason: '未観測' } }) })),
      sending: Object.values(this.view.receipts).filter(r => ['queued', 'sending', 'retry'].includes(r.status)).length };
  }
  publicView() {
    const view = structuredClone(this.view);
    view.configured = Boolean(this.connection?.url && this.connection?.token);
    if (view.hideBuildName) {
      for (const row of Object.values(view.timers)) if (row.data.kind === 'build') row.data.name = '建造艦名非表示';
      for (const update of view.updates) for (const timer of update.timers) if (timer.kind === 'build') timer.name = '建造艦名非表示';
    }
    return view;
  }
}
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  const bridge = new ObservationBridge({ storage: chrome.storage.local, alarm: chrome.alarms,
    broadcast: () => { chrome.runtime.sendMessage({ type: 'view-changed' }).catch(() => {}); } });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (!message || message.type === 'view-changed') return;
    bridge.handle(message).then(value => reply({ value }), e => reply({ error: e.message })); return true;
  });
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'retry') void bridge.flush(); });
  bridge.ready.then(async () => {
    if (bridge.connection && bridge.queue.length > 0) {
      void bridge.flush();
    }
  }).catch(() => {});
}
