export const retryDelay = attempt => Math.min(300000, 1000 * 2 ** Math.min(attempt, 8));
export function targetDeliveryTime(timer, offsetSec) {
  if (timer.state !== 'active' || !Number.isSafeInteger(timer.endAt)) return null;
  return timer.endAt + (timer.kind === 'manual' ? 0 : offsetSec * 1000);
}
export function nextDeliveryAt(state, now) {
  const times = [];
  for (const delivery of Object.values(state.deliveries)) {
    if (!state.settings.providers[delivery.provider] || delivery.status === 'sent' || delivery.status === 'failed' || delivery.status === 'cancelled') continue;
    times.push(Math.max(delivery.dueAt, delivery.nextTryAt || 0, delivery.leaseUntil || 0));
  }
  for (const timer of Object.values(state.timers)) {
    if (timer.state !== 'active') continue;
    for (const event of timer.events || []) {
      if (!Number.isSafeInteger(event.endAt)) continue;
      const dueAt = event.endAt + (timer.kind === 'manual' ? 0 : state.settings.offsetSec * 1000);
      if (dueAt > now - 60000) {
        times.push(dueAt);
      }
    }
  }
  return times.length ? Math.max(now, Math.min(...times)) : null;
}

export function publicTimer(timer, settings, now) {
  const copy = structuredClone(timer);
  if (copy.kind === 'build' && settings.hideBuildName) { copy.name = ''; }
  return copy;
}
