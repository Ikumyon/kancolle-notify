import { MIN_REPAIR, repairProgress } from './akashi.js';

export function getOffsetSec(state) {
  if (Number.isInteger(state.offsetSec) && state.offsetSec !== 0) return state.offsetSec;
  // 後方互換性: 旧 notificationAdvanceSec (正の数で早める) を負のオフセットとして扱う
  if (Number.isInteger(state.notificationAdvanceSec) && state.notificationAdvanceSec > 0) {
    return -state.notificationAdvanceSec;
  }
  return state.offsetSec || 0;
}

export function targetDeliveryTime(slot, offsetSec) {
  if (!slot || slot.state !== 'active' || !Number.isSafeInteger(slot.end)) return null;
  // 建造や手動予約はオフセット調整の対象外（定刻通り）
  if (slot.kind === 'build' || slot.kind === 'manual') return slot.end;
  return slot.end + offsetSec * 1000;
}

export function nextDeliveryAt(state, now, claimDeliveryFn) {
  if (state.authBlocked) return null;
  if (claimDeliveryFn) {
    const s = structuredClone(state);
    if (claimDeliveryFn(s, now, 'alarm-preview')) return now;
  }
  if (state.delivery) {
    return Math.max(now, state.delivery.nextTry || 0, state.delivery.leaseUntil || 0);
  }

  const offsetSec = getOffsetSec(state);
  const times = [];

  for (const r of Object.values(state.slots || {})) {
    if (r.state !== 'active') continue;
    if (r.kind === 'akashi' && r.repair) {
      const sent = r.repairSent || [];
      const offsetMs = offsetSec * 1000;
      if (!sent.includes('start')) times.push(r.repair.start + MIN_REPAIR + offsetMs);
      for (const ship of r.repair.ships) {
        if (!sent.includes(String(ship.id))) {
          times.push(repairProgress(ship, r.repair.start, now).end + offsetMs);
        }
      }
    } else if (!(r.sent && r.sent.generation === r.generation)) {
      const t = targetDeliveryTime(r, offsetSec);
      if (t !== null) times.push(t);
    }
  }

  const valid = times.filter(Number.isSafeInteger);
  return valid.length ? Math.max(now, Math.min(...valid)) : null;
}
