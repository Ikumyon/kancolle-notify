import { validRepair, repairProgress, repairLine, MIN_REPAIR } from './akashi.js';
import { retryDelay } from './retry.js';
import { validId, validGeneration, isCurrent } from './generation.js';
export const emptyState = () => ({ epoch: crypto.randomUUID(), generation: '0', activeSession: null, starts: {}, slots: {}, history: [], delivery: null, authBlocked: false });
const keyOf = e => `${e.kind}:${e.slot}`;
const equal = (a, b) => a.state === b.state && a.end === b.end && a.subject === b.subject && a.name === (b.name || '') && JSON.stringify(a.repair || null) === JSON.stringify(b.repair || null);
export function history(s, now, type, detail) {
  s.history.push({ ...detail, at: now, type });
}
export function prune(s, now) {
  s.history = s.history.filter(h => h.at >= now - 30 * 86400000);
  // Generation tombstones and session high-water marks deliberately outlive display history.
}
export function validateObservation(o, now) {
  if (!o || !validId(o.session) || !validId(o.epoch) || !validGeneration(o.generation)
    || !Number.isSafeInteger(o.seq) || o.seq < 1 || Object.hasOwn(o, 'time')) return false;
  if (!Array.isArray(o.events) || o.events.length > 20 || !Array.isArray(o.errors) || o.errors.length > 20) return false;
  const seen = new Set();
  for (const e of o.events) {
    if (!e || !['expedition', 'repair', 'build', 'fatigue', 'akashi'].includes(e.kind) || !Number.isInteger(e.slot)
      || e.slot < (e.kind === 'expedition' ? 2 : 1) || e.slot > 4
      || !['snapshot', 'start', 'change', 'complete'].includes(e.action)
      || !['active', 'pending', 'empty', 'complete'].includes(e.state)) return false;
    if (e.action === 'start' && e.state !== 'pending' || e.action === 'complete' && e.state !== 'complete'
      || e.action === 'change' && (e.kind !== 'expedition' || e.state !== 'active')
      || e.action === 'snapshot' && e.state === 'pending' && !['fatigue', 'akashi'].includes(e.kind)) return false;
    if (e.kind === 'akashi' && (e.action !== 'snapshot' || (e.state === 'active' ? !validRepair(e.repair) || e.end !== e.repair.start + MIN_REPAIR || e.subject !== e.repair.start : e.repair !== null))) return false;
    if (e.kind === 'fatigue' && (e.action !== 'snapshot' || e.subject !== null && e.subject > 101)) return false;
    if (e.state === 'active' ? !Number.isSafeInteger(e.end) || e.end <= 0 : e.end !== null) return false;
    if (e.subject !== null && (!Number.isSafeInteger(e.subject) || e.subject <= 0)) return false;
    if (e.state === 'active' && e.kind !== 'build' && e.subject === null) return false;
    if (e.name !== undefined && (typeof e.name !== 'string' || e.name.length > 80)) return false;
    const k = keyOf(e); if (seen.has(k)) return false; seen.add(k);
  }
  return o.errors.every(e => typeof e === 'string' && /^[a-z_]{1,50}$/.test(e));
}
export function observe(s, input, device, now) {
  if (!validateObservation(input, now)) throw new Error('invalid_observation');
  if (!isCurrent(s, input, device)) return { seq: input.seq, status: 'stale_session', results: [] };
  if (input.seq <= s.activeSession.seq) return { seq: input.seq, status: 'duplicate', results: [] };
  s.activeSession.seq = input.seq;
  const results = [];
  for (const raw of input.events) {
    const e = { kind: raw.kind, slot: raw.slot, action: raw.action, state: raw.state,
      end: raw.end, subject: raw.subject, name: raw.name || '', ...(raw.kind === 'akashi' ? { repair: structuredClone(raw.repair) } : {}) };
    const key = keyOf(e), previous = s.slots[key];
    if (previous && equal(previous, e) && e.action !== 'start') {
      results.push({ key, status: 'same' }); continue;
    }
    const newActivity = e.action === 'start' || previous && (
      ['empty', 'complete'].includes(previous.state) && ['pending', 'active'].includes(e.state)
      || previous.state === 'active' && e.state === 'active' && previous.subject !== e.subject
      || previous.sent && e.state === 'active' && previous.end !== e.end && e.action !== 'change');
    s.slots[key] = { ...e, generation: previous ? previous.generation + (newActivity ? 1 : 0) : 1,
      revision: (previous?.revision || 0) + 1, sent: previous?.sent || null,
      ...(e.kind === 'akashi' ? { repairSent: previous?.repair?.start === e.repair?.start ? previous?.repairSent || [] : [] } : {}),
      observation: { device, session: input.session, seq: input.seq, receivedAt: now } };
    results.push({ key, status: 'applied' });
    history(s, now, 'observation', { key, status: 'applied', end: e.end });
  }
  for (const code of input.errors) history(s, now, 'parse_error', { device, code });
  prune(s, now);
  return { seq: input.seq, status: 'accepted', results };
}

function itemFor(key, r, now) {
  if (r.kind === 'akashi') {
    if (r.state !== 'active' || !r.repair) return null;
    const sent = r.repairSent || [];
    const due = [{ id: 'start', end: r.repair.start + MIN_REPAIR }, ...r.repair.ships.map(ship => ({ id: String(ship.id), end: repairProgress(ship, r.repair.start, now).end }))].filter(x => x.end <= now && !sent.includes(x.id));
    if (!due.length) return null;
    return { key, kind: r.kind, slot: r.slot, generation: r.generation, revision: r.revision, type: 'normal', end: Math.min(...due.map(x => x.end)), state: r.state, repair: structuredClone(r.repair), milestones: due.map(x => x.id), at: now };
  }
  const sent = r.sent?.generation === r.generation ? r.sent : null;
  if (sent) {
    const changedEnd = r.state === 'active' && r.end !== sent.end;
    const earlyComplete = (['complete', 'empty'].includes(r.state) && r.observation.receivedAt < sent.end)
      || r.kind === 'fatigue' && r.state === 'pending';
    if (!(changedEnd || earlyComplete) || sent.correctedRevision === r.revision) return null;
    return { key, kind: r.kind, slot: r.slot, generation: r.generation, revision: r.revision,
      type: 'correction', end: r.end, state: r.state, name: r.name };
  }
  if (r.state !== 'active' || r.end > now) return null;
  return { key, kind: r.kind, slot: r.slot, generation: r.generation, revision: r.revision,
    type: now - r.end >= 120000 ? 'delayed' : 'normal', end: r.end, state: r.state,
    name: r.name };
}
export function manualReservation(s, command, device, now) {
  if (!command || typeof command.id !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(command.id)
    || !['create', 'cancel'].includes(command.action)) throw new Error('invalid_manual');
  const key = `manual:${command.id}`, existing = s.slots[key];
  if (command.action === 'cancel') {
    if (!existing) throw new Error('manual_not_found');
    if (existing.state !== 'complete') {
      existing.state = 'complete'; existing.end = null; existing.revision++;
      existing.observation = { device, session: command.id, seq: existing.revision, receivedAt: now };
      history(s, now, 'manual_cancel', { key, name: existing.name });
    }
    return { key, reservation: structuredClone(existing), status: 'cancelled' };
  }
  // Request ID is persisted before send. Retrying an ambiguous create never shifts the timer.
  if (existing) return { key, reservation: structuredClone(existing), status: 'duplicate' };
  if (typeof command.title !== 'string' || command.title.trim().length < 1 || command.title.length > 80) throw new Error('invalid_manual');
  const end = command.mode === 'minutes' && Number.isInteger(command.minutes) && command.minutes >= 1 && command.minutes <= 525600
    ? now + command.minutes * 60000 : command.mode === 'datetime' ? command.end : null;
  if (!Number.isSafeInteger(end) || end <= now || end > now + 366 * 86400000) throw new Error('invalid_manual');
  if (Object.values(s.slots).filter(r => r.kind === 'manual' && r.state === 'active' && !r.sent).length >= 10) throw new Error('manual_limit');
  const r = { kind: 'manual', slot: null, name: command.title.trim(), state: 'active', action: 'start',
    end, subject: null, generation: 1, revision: 1, sent: null,
    observation: { device, session: command.id, seq: 1, receivedAt: now } };
  s.slots[key] = r;
  history(s, now, 'manual_create', { key, name: r.name, end });
  return { key, reservation: structuredClone(r), status: 'applied' };
}
export function claimDelivery(s, now, token) {
  if (s.authBlocked) return null;
  let d = s.delivery;
  if (d && d.leaseUntil > now || d && d.nextTry > now) return null;
  if (d) {
    // A retry after a crash/timeout may follow a successful external send. Track that possibility.
    for (const item of d.uncertain ? d.items : []) {
      const r = s.slots[item.key];
      if (r && r.kind !== 'akashi' && r.generation === item.generation && !r.sent) {
        r.sent = { generation: item.generation, revision: item.revision, end: item.end, uncertain: true };
      }
    }
    const stillCurrent = d.items.filter(i => {
      const r = s.slots[i.key]; return r && r.generation === i.generation && r.revision === i.revision;
    });
    if (!stillCurrent.length) { s.delivery = null; d = null; }
    else {
      d.items = stillCurrent.map(i => i.kind === 'akashi' ? itemFor(i.key, s.slots[i.key], now) : i).filter(Boolean);
      if (!d.items.length) { s.delivery = null; d = null; }
    }
  }
  if (!d) {
    const items = Object.entries(s.slots).map(([k, r]) => itemFor(k, r, now)).filter(Boolean);
    if (!items.length) return null;
    d = { id: token, items, attempt: 0, nextTry: 0, leaseUntil: 0 };
  }
  d.token = token; d.leaseUntil = now + 60000; d.attempt += 1; d.uncertain = true;
  s.delivery = d;
  return structuredClone(d);
}
export function finishDelivery(s, token, now, result) {
  const d = s.delivery;
  if (!d || d.token !== token) return false;
  if (result.ok) {
    for (const item of d.items) {
      const r = s.slots[item.key];
      if (r && r.generation === item.generation) {
        if (item.kind === 'akashi' && r.repair?.start === item.repair.start) r.repairSent = [...new Set([...(r.repairSent || []), ...item.milestones])];
        r.sent = { generation: item.generation, revision: item.revision, end: item.end,
          correctedRevision: item.type === 'correction' ? item.revision : null };
      }
      history(s, now, 'sent', { ...item, deliveryType: item.type, messageId: result.messageId || null });
    }
    s.delivery = null;
  } else {
    d.leaseUntil = 0;
    d.uncertain = !!result.uncertain;
    d.nextTry = now + Math.max(retryDelay(d.attempt), result.retryAfter || 0);
    s.authBlocked = !!result.permanent;
    history(s, now, 'send_error', { code: result.code || 'transport', attempt: d.attempt });
  }
  prune(s, now); return true;
}
export function formatDelivery(d) {
  const labels = { expedition: '遠征', repair: '入渠', build: '建造', fatigue: '疲労回復見込み' };
  const date = n => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(n);
  return d.items.map(i => {
    if (i.kind === 'akashi') return `第${i.slot}艦隊 泊地修理${i.milestones.includes('start') ? '開始（20分経過）' : ' 全回復見込み'}\nHP回復見込み\n${i.repair.ships.map(ship => repairLine(ship, i.repair.start, i.at)).join('\n')}`;
    const prefix = i.type === 'correction' ? '【訂正】' : i.type === 'delayed' || d.attempt > 1 ? '【遅延通知】' : '';
    const title = i.kind === 'manual' ? `手動予約 ${i.name}` : `${labels[i.kind]} ${['expedition', 'fatigue'].includes(i.kind) ? '第' + i.slot + '艦隊' : '第' + i.slot + 'ドック'}${i.name ? ' ' + i.name : ''}`;
    const text = i.type === 'correction' ? i.end ? `終了予定を${date(i.end)}に更新しました` : '終了予定の通知は不要になりました'
      : i.kind === 'fatigue' ? `目標の疲労度に回復する見込みの時刻です（${date(i.end)}）。母港で実際の疲労度を確認してください。`
      : `終了予定時刻になりました（${date(i.end)}）`;
    return `${prefix}${title}\n${text}`;
  }).join('\n\n');
}
