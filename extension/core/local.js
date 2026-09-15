import { fatigueEvents, emptyFatigueSettings } from './fatigue.js';

export function transmissionHistory(s) {
  const sent = (s.recentSent || []).map(r => ({ ...r,
    sendError: r.sendError || (r.result?.status === 'stale_session' ? 'stale_session' : ''),
    deliveryStatus: r.result?.status === 'stale_session' ? 'error' : 'sent' }));
  const pending = (s.queue || []).map((r, i) => {
    const sendError = r.sendError || (i < 10 && (s.blocked || s.retryPending) ? s.lastError : '');
    return { ...r, sendError, deliveryStatus: sendError ? 'error' : 'pending',
      queuedAt: r.queuedAt ?? ((s.lastSync || 0) + i + 1) };
  });
  const c = s.pendingManual;
  const manual = c ? [{ session: c.id, queuedAt: c.queuedAt, sendError: c.sendError,
    deliveryStatus: c.sendError ? 'error' : 'pending', events: [{ kind: 'manual', action: c.action,
      name: c.title || s.manualSlots?.[`manual:${c.id}`]?.name || '', state: 'pending', end: c.end || null }], errors: [] }] : [];
  return [...sent, ...pending, ...manual].sort((a, b) => (a.queuedAt ?? a.receivedAt ?? 0) - (b.queuedAt ?? b.receivedAt ?? 0)).slice(-10);
}

// 保存済みの端末データだけで表示を作る。送信処理の完了を待たない。
export function localView(s) {
  const queue = s.queue || [];
  return {
    configured: !!s.config, url: s.config?.url || '', queued: queue.length,
    lastSync: s.lastSync, lastError: s.lastError, blocked: !!s.blocked,
    recentSent: s.recentSent || [], pending: queue.slice(-20).map(o => ({
      session: o.session, seq: o.seq, epoch: s.play?.ticket?.epoch,
      generation: s.play?.ticket?.generation, events: o.events, errors: o.errors
    })),
    transmissions: transmissionHistory(s),
    pendingManual: s.pendingManual || null,
    fatigueSettings: s.fatigueSettings || emptyFatigueSettings(),
    fatigue: fatigueEvents(s.fatigueSnapshot, s.fatigueSettings || emptyFatigueSettings()),
    akashi: s.akashi || [], fatigueSnapshot: s.fatigueSnapshot || null,
    testMode: !!s.testMode, hideBuildName: !!s.hideBuildName,
    localSlots: s.localSlots || s.expeditionSlots || {}, manualSlots: s.manualSlots || {},
    errors: s.errors || [], collectors: s.collectors || {}
  };
}
