// Uses only already-received game responses. No clocks are fetched and no game requests are made.
const NATURAL = 180000, FEEDING = 900000;
const power = id => ({ 996: 2, 1002: 3 })[id] || 0;
export const validTarget = n => Number.isInteger(n) && n >= 0 && n <= 100;
export function fatigueSettings(value = {}) {
  if (!Array.isArray(value.presets) || value.presets.length > 12 || !value.presets.every(validTarget)
    || new Set(value.presets).size !== value.presets.length
    || !(value.defaultTarget === null || validTarget(value.defaultTarget))
    || value.defaultTarget !== null && !value.presets.includes(value.defaultTarget)) throw new Error('invalid_fatigue_settings');
  const fleets = {};
  for (let id = 1; id <= 4; id++) {
    const selected = value.fleets?.[id];
    if (value.presets.includes(selected)) fleets[id] = selected;
  }
  return { presets: value.presets, defaultTarget: value.defaultTarget, fleets };
}
export const emptyFatigueSettings = () => ({ presets: [], defaultTarget: null, fleets: {} });
export function targetFor(settings, fleet) { return settings.fleets?.[fleet] ?? settings.defaultTarget ?? null; }
export function fleetMinCond(snapshot, fleet) {
  const f = snapshot?.fleets?.[fleet];
  if (!f || !Array.isArray(f.ships) || !f.ships.length) return null;
  const conds = f.ships.map(id => snapshot?.ships?.[id]?.cond).filter(validTarget);
  return conds.length ? Math.min(...conds) : null;
}

export const fatigueApis = new Set([
  'api_req_hensei/change', 'api_req_hensei/preset_select', 'api_req_hokyu/charge',
  'api_req_member/itemuse_cond', 'api_req_map/start', 'api_req_map/next',
  'api_req_sortie/battle', 'api_req_battle_midnight/battle', 'api_req_practice/battle',
  'api_req_practice/midnight_battle', 'api_req_combined_battle/battle',
  'api_req_combined_battle/battle_water', 'api_req_combined_battle/ec_battle',
  'api_req_combined_battle/each_battle', 'api_req_combined_battle/each_battle_water',
  'api_req_kaisou/powerup', 'api_req_kaisou/remodeling', 'api_req_kousyou/destroyship'
]);
export class FatigueTracker {
  constructor() { this.reset(); }
  reset() { this.state = { ships: {}, fleets: {}, docks: [], docksKnown: false, fuel: null, feedingAt: null, at: null, needsPort: true }; this.masters = {}; }
  apply(api, b, p, at) {
    const s = this.state, d = b.api_data;
    if (Array.isArray(d?.api_mst_ship)) for (const m of d.api_mst_ship) this.masters[m.api_id] = { fuel: m.api_fuel_max, ammo: m.api_bull_max };
    if (!Number.isSafeInteger(at) || at <= 0) {
      // Missing response Date must invalidate old estimates, not substitute the PC clock.
      if (!api.startsWith('api_start2')) s.needsPort = true;
      return structuredClone(s);
    }
    s.at = at;
    const rows = api === 'api_port/port' ? d?.api_ship : api === 'api_get_member/ship2' ? d : d?.api_ship_data ?? (api === 'api_req_hokyu/charge' ? d?.api_ship : null);
    if (Array.isArray(rows)) for (const r of rows) {
      if (!Number.isInteger(r.api_id)) continue;
      const old = s.ships[r.api_id] || {};
      s.ships[r.api_id] = { ...old,
        ...(Number.isInteger(r.api_ship_id) ? { master: r.api_ship_id } : {}),
        ...(validTarget(r.api_cond) ? { cond: r.api_cond, at: old.cond === r.api_cond && !s.needsPort ? old.at : at } : {}),
        ...(Number.isFinite(r.api_nowhp) ? { hp: r.api_nowhp, maxhp: r.api_maxhp } : {}),
        ...(Number.isFinite(r.api_fuel) ? { fuel: r.api_fuel } : {}),
        ...(Number.isFinite(r.api_bull) ? { ammo: r.api_bull } : {}) };
    }
    let fleets = api === 'api_port/port' ? d?.api_deck_port : api === 'api_get_member/deck' ? d
      : api === 'api_get_member/ship2' ? b.api_data_deck : d?.api_deck_data;
    if (api === 'api_req_hensei/preset_select' && d?.api_ship) fleets = [d];
    if (Array.isArray(fleets)) for (const f of fleets) {
      if (f.api_id >= 1 && f.api_id <= 4 && Array.isArray(f.api_ship)) s.fleets[f.api_id] = {
        ships: f.api_ship.filter(id => id > 0), away: !Array.isArray(f.api_mission) || f.api_mission[0] !== 0 };
    }
    const docks = api === 'api_port/port' ? d?.api_ndock : api === 'api_get_member/ndock' ? d : null;
    if (Array.isArray(docks)) { s.docks = docks.filter(r => r.api_state > 0).map(r => r.api_ship_id); s.docksKnown = true; }
    const material = d?.api_material;
    if (Array.isArray(material)) {
      const fuel = material.find(m => m?.api_id === 1)?.api_value ?? (typeof material[0] === 'number' ? material[0] : null);
      if (Number.isFinite(fuel)) s.fuel = fuel;
    }
    if (api === 'api_req_hensei/change') {
      const fleet = s.fleets[p.api_id], index = p.api_ship_idx, ship = p.api_ship_id;
      const changed = new Set([fleet]);
      if (fleet && d?.api_change_count > 0) fleet.ships = fleet.ships.slice(0, 1);
      else if (fleet && Number.isInteger(index) && index >= 0 && index < 7) {
        if (ship === -2) fleet.ships = fleet.ships.slice(0, 1);
        else if (ship === -1) fleet.ships.splice(index, 1);
        else if (ship > 0) {
          const replaced = fleet.ships[index];
          for (const f of Object.values(s.fleets)) {
            const other = f.ships.indexOf(ship);
            if (other >= 0) { changed.add(f); if (replaced) f.ships[other] = replaced; else f.ships.splice(other, 1); break; }
          }
          fleet.ships[index] = ship;
        }
        fleet.ships = fleet.ships.filter(id => id > 0);
        if (ship !== -2 && [...changed].some(f => f?.ships.slice(0, 2).some(id => power(s.ships[id]?.master)))) s.feedingAt = at;
      } else s.needsPort = true;
    }
    if (api === 'api_req_hensei/preset_select' && !s.feedingAt
      && Object.values(s.fleets).some(f => f.ships.slice(0, 2).some(id => power(s.ships[id]?.master)))) s.feedingAt = at;
    if (api === 'api_port/port') {
      s.needsPort = !(Array.isArray(rows) && Array.isArray(fleets) && Array.isArray(docks));
      // The feeding timer is shared across fleets. A port application restarts it.
      if (!s.needsPort && s.feedingAt && at - s.feedingAt >= FEEDING) s.feedingAt = at;
    } else if (fatigueApis.has(api) && !['api_req_hensei/change', 'api_req_hensei/preset_select', 'api_req_hokyu/charge'].includes(api)
      || ['api_req_mission/start', 'api_req_mission/result', 'api_req_nyukyo/start', 'api_req_nyukyo/speedchange'].includes(api)) s.needsPort = true;
    for (const ship of Object.values(s.ships)) {
      const m = this.masters[ship.master];
      ship.supplied = !!m && ship.fuel === m.fuel && ship.ammo === m.ammo;
    }
    return structuredClone(s);
  }
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
    // Conservative estimate: first reach natural cap, then apply feeding at shared 15-minute boundaries.
    // No future repair, replenishment, or fuel income is assumed.
    const naturalReady = Math.max(...recipients.map(r => natural(r, Math.min(target, 49))), natural(provider, 30));
    const rounds = Math.max(...recipients.map(r => Math.ceil(Math.max(0, target - Math.max(r.cond, 49)) / power(provider.master))));
    const first = s.feedingAt + Math.max(1, Math.ceil((naturalReady - s.feedingAt) / FEEDING)) * FEEDING;
    const end = first + Math.max(0, rounds - 1) * FEEDING;
    // Reserve a sufficient bound for all fleets competing for the common stockpile.
    const possibleRecipients = Object.values(s.fleets).reduce((n, fleet) => n + fleet.ships.length, 0);
    const maxCost = possibleRecipients * Math.max(1, Math.ceil((end - s.feedingAt) / FEEDING));
    if (!(s.fuel >= maxCost)) return pending(`目標 ${target}：給糧用燃料が不足または不明`);
    return { ...base, state: 'active', end, name: `目標 ${target}・給糧の見込み（母港で反映）` };
  });
}
