// ゲーム固有の状態復元・完了時刻計算は拡張だけで行う。
import { emptyGame, applyGameObservation, targetFor, fatigueFor, akashiFor } from './recovery.js';
import { defaultCalculationSettings } from './calculation-settings.js';
export const calculationState = (settings = defaultCalculationSettings(), registry = {}) => ({ game: emptyGame(), timers: {}, settings, registry, newActivities: new Set() });
function updateTimer(s, timer, now, newActivity = false) {
  s.timers[timer.id] = timer;
  if (newActivity) s.newActivities.add(timer.id);
}
const positive = value => Number.isSafeInteger(value) && value > 0;
const num = (o, key) => Number(o.request[key]);
export function calculate(s, o, now = o.responseDate || o.observedAt) {
  s.newActivities = new Set();
  const wasReady = s.game.portReady;
  const g = s.game, rows = applyGameObservation(g, o), at = o.responseDate;
  const shipName = id => g.shipMasters[g.ships[id]?.api_ship_id]?.api_name || (id ? `艦ID ${id}` : '');
  const missionName = id => g.missionMasters[id]?.api_name || (id ? `遠征ID ${id}` : '');
  const set = (kind, slot, state, endAt, subjectId = null, name = '', newActivity = false) => updateTimer(s, {
    id: `${kind}:${slot}`, kind, slot, state, endAt, subjectId, name, detail: {}, observedAt: o.observedAt }, now, newActivity);
  if (Array.isArray(rows.fleets)) for (const f of rows.fleets) if (f.api_id >= 2 && f.api_id <= 4 && Array.isArray(f.api_mission)) {
    const m = f.api_mission;
    set('expedition', f.api_id, m[0] === 0 ? 'empty' : positive(m[2]) ? 'active' : 'pending', m[0] > 0 && positive(m[2]) ? m[2] : null, m[1] || null, missionName(m[1]));
  }
  for (const kind of ['repair', 'build']) if (Array.isArray(rows[kind])) for (const d of rows[kind]) if (d.api_id >= 1 && d.api_id <= 4) {
    const active = d.api_state > 0, complete = kind === 'build' && d.api_state === 3;
    const subject = kind === 'repair' ? d.api_ship_id : d.api_created_ship_id;
    set(kind, d.api_id, !active ? 'empty' : complete ? 'complete' : positive(d.api_complete_time) ? 'active' : 'pending',
      active && !complete && positive(d.api_complete_time) ? d.api_complete_time : null, subject || null,
      kind === 'repair' ? shipName(subject) : g.shipMasters[subject]?.api_name || '');
  }
  const api = o.api, d = o.response.api_data;
  if (api === 'api_req_mission/start') {
    const id = num(o, 'api_deck_id'), mission = num(o, 'api_mission_id');
    if (id >= 2 && id <= 4) { g.away[id] = true; set('expedition', id, positive(d?.api_complatetime) ? 'active' : 'pending',
      positive(d?.api_complatetime) ? d.api_complatetime : null, mission, missionName(mission), true); }
  }
  if (api === 'api_req_mission/return_instruction') {
    const id = num(o, 'api_deck_id'), m = d?.api_mission;
    if (id >= 2 && id <= 4) set('expedition', id, positive(m?.[2]) ? 'active' : 'pending', positive(m?.[2]) ? m[2] : null, m?.[1] || null, missionName(m?.[1]));
  }
  if (api === 'api_req_mission/result') {
    const id = num(o, 'api_deck_id');
    if (id >= 2 && id <= 4) { g.away[id] = false; set('expedition', id, 'complete', null); }
  }
  for (const [kind, prefix, field] of [['repair', 'api_req_nyukyo/', 'api_ndock_id'], ['build', 'api_req_kousyou/', 'api_kdock_id']]) {
    const start = kind === 'repair' ? 'start' : 'createship', speed = kind === 'repair' ? 'speedchange' : 'createship_speedchange';
    const id = num(o, field);
    if (id < 1 || id > 4 || !Number.isInteger(id)) continue;
    if (api === prefix + start || api === prefix + speed) {
      const complete = api === prefix + speed || num(o, 'api_highspeed') === 1;
      const subject = kind === 'repair' ? num(o, 'api_ship_id') || s.timers[`${kind}:${id}`]?.subjectId : null;
      const repairMs = kind === 'repair' ? g.ships[subject]?.api_ndock_time : null;
      const endAt = !complete && at && positive(repairMs) ? at + repairMs : null;
      set(kind, id, complete ? 'complete' : endAt ? 'active' : 'pending', endAt, subject, kind === 'repair' ? shipName(subject) : '', api === prefix + start);
      if (kind === 'repair') g.repair[id] = { api_id: id, api_state: complete ? 0 : 1, api_ship_id: subject };
    }
    if (kind === 'build' && api === prefix + 'getship' && !Array.isArray(rows.build)) set(kind, id, 'empty', null);
  }
  if (wasReady && !g.portReady) for (const [key, value] of Object.entries(s.registry)) {
    if (key.startsWith('fatigue:') || key.startsWith('akashi:')) value.restart = true;
  }
  recompute(s, now);

}
export function recompute(s, now, settingsOnly = false) {
  for (let slot = 1; slot <= 4; slot++) {
    if (!s.game.fleets[slot] && !settingsOnly) continue;
    updateTimer(s, { id: `fatigue:${slot}`, kind: 'fatigue', slot, name: '疲労回復', subjectId: targetFor(s.settings, slot),
      ...fatigueFor(s.game, s.game.fleets[slot], targetFor(s.settings, slot)) }, now, false, settingsOnly);
    if (slot <= 2) updateTimer(s, { id: `akashi:${slot}`, kind: 'akashi', slot, name: '泊地修理', subjectId: null,
      ...akashiFor(s.game, s.game.fleets[slot], now) }, now);
  }

}

async function fingerprint(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export async function timerUpdates(s, reason = 'observation', onlyFatigue = false) {
  const updates = [];
  for (const t of Object.values(s.timers)) {
    if (onlyFatigue && t.kind !== 'fatigue') continue;
    const previous = s.registry[t.id];
    // 回復時刻は再読取で基準が変わり得るため、活動識別には使わない。
    const identity = await fingerprint([t.kind, t.slot, ['fatigue', 'akashi'].includes(t.kind) ? null : t.subjectId]);
    const active = t.state === 'active';
    const changedSubject = previous?.identity && previous.identity !== identity && t.subjectId != null && !['fatigue', 'akashi'].includes(t.kind);
    const fresh = !previous || reason === 'observation' && (s.newActivities.has(t.id) || active && (previous.closed || previous.restart || changedSubject));
    const entry = fresh ? { activityId: crypto.randomUUID(), closed: false, restart: false } : previous;
    if (active) { entry.identity = identity; entry.closed = false; entry.restart = false; }
    if (reason === 'observation' && ['complete', 'empty', 'cancelled'].includes(t.state)) entry.closed = true;
    s.registry[t.id] = entry;
    const phases = t.kind === 'akashi' ? [['start', t.detail?.firstAt], ['full', t.endAt]] : [['complete', t.endAt]];
    updates.push({ id: t.id, kind: t.kind, slot: t.slot, name: t.name || '', state: t.state,
      endAt: active ? t.endAt : null,
      events: phases.map(([phase, endAt]) => ({ id: entry.activityId + '-' + phase, phase, endAt: active && Number.isSafeInteger(endAt) ? endAt : null })) });
  }
  s.newActivities.clear();
  return updates;
}
