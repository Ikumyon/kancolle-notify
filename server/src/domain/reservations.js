import { kinds, updateTimer, validId, record } from './state.js';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const time = value => Number.isSafeInteger(value) && value > 0;
export function validateUpdate(u) {
  if (!object(u) || !(u.observedAt === null || time(u.observedAt)) || !['observation', 'settings'].includes(u.reason) ||
    !Array.isArray(u.timers) || !u.timers.length || u.timers.length > 32) throw new Error('invalid_update');
  const ids = new Set(), events = new Set();
  for (const t of u.timers) {
    if (!exact(t, ['id', 'kind', 'slot', 'name', 'state', 'startAt', 'endAt', 'events']) || !kinds.includes(t.kind) ||
      !Number.isInteger(t.slot) || t.slot < 1 || t.slot > 4 || t.id !== `${t.kind}:${t.slot}` || ids.has(t.id) ||
      typeof t.name !== 'string' || t.name.length > 200 || !['pending', 'empty', 'active', 'complete', 'cancelled'].includes(t.state) ||
      (t.startAt !== null && !time(t.startAt)) ||
      !Array.isArray(t.events) || !t.events.length || t.events.length > 10 ||
      (t.state === 'active' ? !time(t.endAt) : t.endAt !== null)) throw new Error('invalid_timer');
    ids.add(t.id);
    const phases = new Set();
    for (const e of t.events) {
      const hasText = Object.hasOwn(e, 'text');
      const validKeys = hasText ? ['id', 'phase', 'endAt', 'text'] : ['id', 'phase', 'endAt'];
      if (!exact(e, validKeys) || !validId(e.id) || !validId(e.phase) || events.has(e.id) || phases.has(e.phase) ||
        (hasText && (typeof e.text !== 'string' || e.text.length > 200)) ||
        (t.state === 'active' ? !time(e.endAt) : e.endAt !== null)) throw new Error('invalid_event');
      events.add(e.id); phases.add(e.phase);
    }
    if (t.state === 'active' && t.endAt !== Math.max(...t.events.map(e => e.endAt))) throw new Error('invalid_timer');
  }
}
export function receiveUpdate(s, u, device, now) {
  validateUpdate(u);
  const receipt = { sequence: u.sequence ?? 0, receivedAt: now };
  for (const t of u.timers) for (const e of t.events) {
    if (Object.values(s.timers).some(old => old.id !== t.id && old.events.some(v => v.id === e.id))) throw new Error('invalid_event_owner');
  }
  for (const timer of u.timers) updateTimer(s, { ...structuredClone(timer), observedAt: u.observedAt }, now, u.reason);
  record(s, now, 'timers_received', { count: u.timers.length, reason: u.reason, observedAt: u.observedAt });
  return { ...receipt, status: 'accepted' };
}
