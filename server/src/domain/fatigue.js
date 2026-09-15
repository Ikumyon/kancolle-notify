const NATURAL = 180000, FEEDING = 900000;
const power = id => ({ 996: 2, 1002: 3 })[id] || 0;

export const validTarget = n => Number.isInteger(n) && n >= 0 && n <= 100;

export function fatigueSettings(value = {}) {
  if (!Array.isArray(value.presets) || value.presets.length > 12 || !value.presets.every(validTarget)
    || new Set(value.presets).size !== value.presets.length
    || !(value.defaultTarget === null || validTarget(value.defaultTarget))
    || (value.defaultTarget !== null && !value.presets.includes(value.defaultTarget))) {
    throw new Error('invalid_fatigue_settings');
  }
  const fleets = {};
  for (let id = 1; id <= 4; id++) {
    const selected = value.fleets?.[id];
    if (value.presets.includes(selected)) fleets[id] = selected;
  }
  return { presets: value.presets, defaultTarget: value.defaultTarget, fleets };
}

export const emptyFatigueSettings = () => ({ presets: [], defaultTarget: null, fleets: {} });

export function targetFor(settings, fleet) {
  return settings.fleets?.[fleet] ?? settings.defaultTarget ?? null;
}

export function fleetMinCond(snapshot, fleet) {
  const f = snapshot?.fleets?.[fleet];
  if (!f || !Array.isArray(f.ships) || !f.ships.length) return null;
  const conds = f.ships.map(id => snapshot?.ships?.[id]?.cond).filter(validTarget);
  return conds.length ? Math.min(...conds) : null;
}

function natural(ship, target) {
  if (ship.cond >= target) return ship.at;
  if (target > 49) return null;
  return ship.at + Math.ceil((target - ship.cond) / 3) * NATURAL;
}

export function fatigueEvents(snapshot, settings) {
  const s = snapshot;
  return [1, 2, 3, 4].map(slot => {
    const target = targetFor(settings, slot), f = s?.fleets[slot];
    const base = { kind: 'fatigue', slot, action: 'snapshot', state: 'pending', end: null, subject: target === null ? null : target + 1, name: '' };
    const pending = reason => ({ ...base, name: reason });
    if (target === null) return pending('目標未設定');
    if (!f || s.needsPort || !s.at || !s.docksKnown) return pending('母港の情報待ち');
    if (!f.ships.length) return { ...base, state: 'empty' };
    if (f.away) return pending('遠征中・帰港後に再計算');
    const providerId = f.ships.slice(0, 2).find(id => power(s.ships[id]?.master));
    const provider = s.ships[providerId];
    const recipients = f.ships.filter(id => id !== providerId).map(id => ({ id, ...s.ships[id] }));
    if (!recipients.length) return { ...base, state: 'empty' };
    if (recipients.some(r => !validTarget(r.cond) || !r.at)) return pending('疲労度の情報待ち');
    if (recipients.some(r => s.docks.includes(r.id))) return pending('入渠中・出渠後に再計算');
    if (recipients.every(r => r.cond >= target)) return { ...base, state: 'complete', name: `目標 ${target} 到達` };
    if (target <= 49) return { ...base, state: 'active', end: Math.max(...recipients.map(r => natural(r, target))), name: `目標 ${target}・自然回復の見込み` };
    if (target > 54) return pending(`目標 ${target}：時間経過では到達不可`);
    if (!provider || !provider.supplied || !(provider.hp > provider.maxhp * 0.75) || !validTarget(provider.cond)
      || s.docks.includes(providerId)) return pending(`目標 ${target}：給糧条件未成立`);
    if (!s.feedingAt) return pending(`目標 ${target}：給糧開始時刻が未計測`);

    const naturalReady = Math.max(...recipients.map(r => natural(r, Math.min(target, 49))), natural(provider, 30));
    const rounds = Math.max(...recipients.map(r => Math.ceil(Math.max(0, target - Math.max(r.cond, 49)) / power(provider.master))));
    const first = s.feedingAt + Math.max(1, Math.ceil((naturalReady - s.feedingAt) / FEEDING)) * FEEDING;
    const end = first + Math.max(0, rounds - 1) * FEEDING;
    const possibleRecipients = Object.values(s.fleets).reduce((n, fleet) => n + fleet.ships.length, 0);
    const maxCost = possibleRecipients * Math.max(1, Math.ceil((end - s.feedingAt) / FEEDING));
    if (!(s.fuel >= maxCost)) return pending(`目標 ${target}：給糧用燃料が不足または不明`);
    return { ...base, state: 'active', end, name: `目標 ${target}・給糧の見込み（母港で反映）` };
  });
}
