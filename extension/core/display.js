export const isNotified = r => r.kind === 'akashi' ? !!r.repair && ['start', ...r.repair.ships.map(s => String(s.id))].every(id => (r.repairSent || []).includes(id)) : !!r.sent && r.sent.generation === r.generation;
export const visibleReservation = r => ['active', 'pending'].includes(r.state) && !isNotified(r);
// 艦隊の出撃状態は、通知の送信済み・未送信とは別に表示する。
export function expeditionFor(local, fleet) {
  const key = `expedition:${fleet}`;
  return local?.localSlots?.[key] || null;
}
export function remainingText(end, now) {
  if (!Number.isFinite(end) || !Number.isFinite(now)) return '時刻未取得';
  if (end <= now) return '予定時刻到達';
  return `あと${Math.ceil((end - now) / 60000)}分`;
}
