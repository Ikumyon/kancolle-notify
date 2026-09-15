export const MIN_REPAIR = 1200000;
const minute = n => Math.ceil(n / 60000) * 60000;
const positive = n => Number.isSafeInteger(n) && n > 0;

export function repairProgress(ship, start, now) {
  const missing = ship.max - ship.hp;
  const tick = Math.ceil(minute((ship.repair - 30000) * ship.mod) / missing);
  const end = start + (missing === 1 ? MIN_REPAIR : Math.max(MIN_REPAIR, minute(tick * missing)));
  const elapsed = now - start;
  const healed = elapsed < MIN_REPAIR ? 0 : Math.min(missing, Math.max(1, Math.floor(Math.floor(elapsed / 60000) * 60000 / tick)));
  return { hp: ship.hp + healed, healed, end };
}

export function repairLine(ship, start, now) {
  const p = repairProgress(ship, start, now);
  const day = n => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(n);
  const clock = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(p.end);
  return `${ship.name}: ${ship.hp}->${p.hp} +${p.healed}　${now >= p.end ? '全回復' : `あと${Math.ceil((p.end - now) / 60000)}分　${day(now) === day(p.end) ? '' : day(p.end) + ' '}${clock}`}`;
}

export function validRepair(value) {
  return value && positive(value.start) && Array.isArray(value.ships) && value.ships.length > 0 && value.ships.length <= 7
    && new Set(value.ships.map(s => s.id)).size === value.ships.length && value.ships.every(s => positive(s.id)
      && typeof s.name === 'string' && s.name.length <= 80 && positive(s.hp) && positive(s.max) && s.max <= 10000
      && s.hp < s.max && s.hp * 2 > s.max && positive(s.repair) && s.repair > 30000 && s.repair < 31536000000
      && [1, 0.85].includes(s.mod));
}
