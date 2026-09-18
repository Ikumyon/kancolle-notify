import { targetDeliveryTime } from './timer.js';
import { validId, issueSession } from './generation.js';
export { validId } from './generation.js';
export const kinds = ['expedition', 'repair', 'build', 'akashi', 'fatigue'];
export const defaultCalculationSettings = () => ({ fatigueTarget: 49, fatiguePresets: [40, 49], fatigueTargets: {} });
export const defaultSettings = () => ({ offsetSec: 0, providers: { discord: false, telegram: false },
  categories: Object.fromEntries(kinds.map(k => [k, true])), hideBuildName: true,
  calculation: defaultCalculationSettings() });
export const emptyState = () => ({ schema: 2, settings: defaultSettings(), session: null, sessions: {}, timers: {}, deliveries: {}, history: [] });
export function record(s, now, type, detail = {}) { s.history.push({ at: now, type, ...detail }); }
export function beginSession(s, requestId, device, now) {
  const { sessionId, fresh } = issueSession(s, requestId, device);
  if (fresh) record(s, now, 'session_start');
  return { sessionId };
}
export function reconcile(s, now) {
  for (const timer of Object.values(s.timers)) {
    timer.notifyAt = targetDeliveryTime(timer, s.settings.offsetSec);
    const enabled = timer.kind === 'manual' || s.settings.categories[timer.kind];
    for (const d of Object.values(s.deliveries).filter(d => d.timerId === timer.id)) {
      if (['pending', 'sending'].includes(d.status) && (!enabled || !s.settings.providers[d.provider] || d.revision !== timer.revision ||
        !timer.events.some(e => e.id === d.eventId) || timer.state !== 'active')) d.status = 'cancelled';
    }
    if (timer.state === 'active') {
      for (const event of timer.events) for (const provider of ['discord', 'telegram']) {
        if (!enabled || !s.settings.providers[provider] || !Number.isSafeInteger(event.endAt)) continue;
        const dueAt = event.endAt + (timer.kind === 'manual' ? 0 : s.settings.offsetSec * 1000);
        if (dueAt <= now) continue;
        const jobs = Object.values(s.deliveries).filter(d => d.timerId === timer.id && d.eventId === event.id && d.provider === provider);
        const sent = jobs.filter(d => d.status === 'sent');
        if (sent.some(d => d.type === 'notification' && (d.eventEndAt === event.endAt || d.revision === timer.revision))) continue;
        const id = `${event.id}:${timer.revision}:notification:${provider}`;
        let d = s.deliveries[id];
        if (!d) d = s.deliveries[id] = { id, timerId: timer.id, eventId: event.id, revision: timer.revision,
          provider, phase: event.phase, type: 'notification', eventEndAt: event.endAt, text: event.text || null, item: structuredClone(timer),
          status: 'pending', dueAt, nextTryAt: 0, leaseUntil: 0, attempts: 0, createdAt: now };
        if (d.status === 'cancelled') { d.status = 'pending'; d.leaseUntil = 0; }
        if (d.status === 'pending') { d.dueAt = dueAt; d.item = structuredClone(timer); d.text = event.text || null; }
      }
    }
  }
}
export function updateTimer(s, input, now, reason = 'observation') {
  const old = s.timers[input.id];
  if (old?.observedAt && input.observedAt && input.observedAt < old.observedAt) return;
  const changed = !old || JSON.stringify([old.name, old.state, old.events]) !== JSON.stringify([input.name, input.state, input.events]);
  const revision = (old?.revision || 0) + (changed ? 1 : 0);
  s.timers[input.id] = { ...input, revision, updatedAt: changed ? now : old.updatedAt,
    suppressedRevision: reason === 'settings' && changed ? revision : old?.suppressedRevision ?? null, notifyAt: null };
  reconcile(s, now);
}
export function applySettings(s, patch, now) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
    Object.keys(patch).some(k => !['offsetSec', 'providers', 'categories', 'hideBuildName', 'calculation'].includes(k))) throw new Error('invalid_settings');
  const next = structuredClone(s.settings);
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'offsetSec') { if (!Number.isInteger(value) || Math.abs(value) > 3600) throw new Error('invalid_settings'); }
    else if (key === 'hideBuildName') { if (typeof value !== 'boolean') throw new Error('invalid_settings'); }
    else if (key === 'calculation') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_settings');
      const target = v => Number.isInteger(v) && v >= 0 && v <= 54;
      if (value.fatigueTarget !== undefined && !target(value.fatigueTarget)) throw new Error('invalid_settings');
      if (value.fatiguePresets !== undefined && (!Array.isArray(value.fatiguePresets) || value.fatiguePresets.length < 1 || value.fatiguePresets.length > 12 || !value.fatiguePresets.every(target))) throw new Error('invalid_settings');
      if (value.fatigueTargets !== undefined) {
        if (!value.fatigueTargets || typeof value.fatigueTargets !== 'object' || Array.isArray(value.fatigueTargets) || Object.entries(value.fatigueTargets).some(([id, v]) => !['1', '2', '3', '4'].includes(id) || v !== null && !target(v))) throw new Error('invalid_settings');
      }
      next.calculation = { ...next.calculation, ...value };
      if (value.fatigueTargets) next.calculation.fatigueTargets = { ...next.calculation.fatigueTargets, ...value.fatigueTargets };
      continue;
    }
    else {
      if (!value || Array.isArray(value) || typeof value !== 'object' || Object.entries(value).some(([k, v]) => !Object.hasOwn(next[key], k) || typeof v !== 'boolean')) throw new Error('invalid_settings');
      Object.assign(next[key], value); continue;
    }
    next[key] = value;
  }
  s.settings = next;
  for (const d of Object.values(s.deliveries)) if (patch.providers?.[d.provider] === true && d.status === 'failed') { d.status = 'pending'; d.nextTryAt = now; }
  record(s, now, 'settings_changed');
}
export function createManual(s, command, now) {
  if (!command || !validId(command.requestId) || typeof command.name !== 'string' || !command.name.trim() || command.name.length > 80 ||
    Object.keys(command).some(k => !['requestId', 'name', 'endAt', 'minutes'].includes(k)) ||
    Object.hasOwn(command, 'endAt') === Object.hasOwn(command, 'minutes')) throw new Error('invalid_manual');
  const id = 'manual:' + command.requestId;
  if (s.timers[id]) return s.timers[id];
  const endAt = command.endAt ?? now + command.minutes * 60000;
  if (command.minutes !== undefined && (!Number.isInteger(command.minutes) || command.minutes < 1) ||
    !Number.isSafeInteger(endAt) || endAt <= now || endAt > now + 365 * 86400000) throw new Error('invalid_manual');
  if (Object.values(s.timers).filter(t => t.kind === 'manual' && t.state === 'active').length >= 100) throw new Error('manual_limit');
  updateTimer(s, { id, kind: 'manual', slot: null, state: 'active', name: command.name.trim(), endAt, events: [{ id: command.requestId + '-manual', phase: 'complete', endAt }] }, now);
  return s.timers[id];
}
export function cancelManual(s, id, now) {
  const timer = s.timers['manual:' + id];
  if (!timer) throw new Error('manual_not_found');
  if (timer.state !== 'cancelled') updateTimer(s, { ...timer, state: 'cancelled', endAt: null, events: timer.events.map(e => ({ ...e, endAt: null })) }, now);
  return s.timers[timer.id];
}
