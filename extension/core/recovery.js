import { observationRows } from './parser.js';
const positive = value => Number.isSafeInteger(value) && value > 0;
const num = (o, key) => Number(o.request[key]);
export const emptyGame = () => ({ ships: {}, fleets: {}, repair: {}, build: {}, gears: {}, shipMasters: {}, missionMasters: {}, gearMasters: {}, portReady: false, away: {}, akashiAt: {}, portSupplyAt: {} });
export function applyGameObservation(g, o) {
  const rows = observationRows(o.api, structuredClone(o.response)), at = o.responseDate;
  const port = o.api === 'api_port/port';
  const resetRecovery = /^(api_req_(map|sortie|battle_midnight|practice|combined_battle|kaisou)\/)/.test(o.api) ||
    ['api_req_hensei/change', 'api_req_hensei/preset_select', 'api_req_nyukyo/start', 'api_req_nyukyo/speedchange',
      'api_req_mission/start', 'api_req_mission/result', 'api_req_kousyou/destroyship', 'api_req_kousyou/remodel_slot',
      'api_req_kousyou/destroyitem2', 'api_req_member/itemuse_cond'].includes(o.api);
  if (resetRecovery) { g.portReady = false; g.akashiAt = {}; g.portSupplyAt = {}; }
  if (!at && !o.api.startsWith('api_start2')) { g.portReady = false; g.akashiAt = {}; g.portSupplyAt = {}; }
  for (const key of ['shipMasters', 'missionMasters', 'gearMasters', 'gears']) if (Array.isArray(rows[key])) {
    if (key === 'gears' && ['api_get_member/slot_item', 'api_get_member/require_info', 'api_req_member/require_info'].includes(o.api)) g[key] = {};
    for (const row of rows[key]) if (positive(row.api_id)) g[key][row.api_id] = row;
  }
  const previousShips = g.ships;
  if (port && Array.isArray(rows.ships) || o.api === 'api_get_member/ship2') g.ships = {};
  if (Array.isArray(rows.ships)) for (const row of rows.ships) {
    if (!positive(row.api_id)) continue;
    const old = previousShips[row.api_id];
    g.ships[row.api_id] = { ...old, ...row, condAt: row.api_cond === undefined ? old?.condAt ?? null
      : at && old?.api_cond === row.api_cond && g.portReady ? old.condAt : at };
  }
  for (const key of ['fleets', 'repair', 'build']) if (Array.isArray(rows[key])) {
    if (port || ['api_get_member/deck', 'api_get_member/ndock', 'api_get_member/kdock'].includes(o.api)) g[key] = {};
    for (const row of rows[key]) if (positive(row.api_id) && row.api_id <= 4) {
      g[key][row.api_id] = { ...g[key][row.api_id], ...row };
      if (key === 'fleets' && row.api_mission) g.away[row.api_id] = row.api_mission[0] !== 0;
    }
  }
  if (o.api === 'api_req_hensei/change') {
    const f = g.fleets[num(o, 'api_id')], index = num(o, 'api_ship_idx'), id = num(o, 'api_ship_id');
    if (f?.api_ship && (id === -2 || Number.isInteger(index) && index >= 0 && index < 7)) {
      if (id === -2) f.api_ship = f.api_ship.slice(0, 1);
      else if (id === -1) f.api_ship.splice(index, 1);
      else if (id > 0) {
        const old = f.api_ship[index] || -1;
        for (const other of Object.values(g.fleets)) {
          const i = other.api_ship?.indexOf(id) ?? -1;
          if (i >= 0) other.api_ship[i] = old;
        }
        f.api_ship[index] = id;
      }
    }
  }
  if (o.api === 'api_req_map/start') g.away[num(o, 'api_deck_id')] = true;
  if (port && at && Array.isArray(rows.ships) && Array.isArray(rows.fleets) && Array.isArray(rows.repair)) {
    g.portReady = true;
    for (const f of rows.fleets) {
      const hpChanged = f.api_ship?.some(id => previousShips[id] && previousShips[id]?.api_nowhp !== g.ships[id]?.api_nowhp);
      if (!g.akashiAt[f.api_id] || hpChanged) g.akashiAt[f.api_id] = at;
      const ps = portSupplyStatus(g, f);
      if (ps.valid) {
        const condChanged = f.api_ship?.some(id => previousShips[id] && previousShips[id]?.api_cond !== g.ships[id]?.api_cond);
        if (!g.portSupplyAt[f.api_id] || condChanged) g.portSupplyAt[f.api_id] = at;
      } else {
        delete g.portSupplyAt[f.api_id];
      }
    }
  }
  const d = o.response.api_data, id = num(o, 'api_deck_id');
  if (o.api === 'api_req_mission/start' && id >= 2 && id <= 4) {
    g.fleets[id] = { ...g.fleets[id], api_id: id, api_mission: [1, num(o, 'api_mission_id'), d?.api_complatetime || 0] };
    g.away[id] = true;
  }
  if (o.api === 'api_req_mission/return_instruction' && id >= 2 && id <= 4) {
    g.fleets[id] = { ...g.fleets[id], api_id: id, api_mission: Array.isArray(d?.api_mission) ? [...d.api_mission] : [1, 0, 0] };
  }
  if (o.api === 'api_req_mission/result' && id >= 2 && id <= 4) {
    g.fleets[id] = { ...g.fleets[id], api_id: id, api_mission: [0, 0, 0] }; g.away[id] = false;
  }
  for (const [kind, prefix, field] of [['repair', 'api_req_nyukyo/', 'api_ndock_id'], ['build', 'api_req_kousyou/', 'api_kdock_id']]) {
    const slot = num(o, field);
    if (!Number.isInteger(slot) || slot < 1 || slot > 4) continue;
    const start = kind === 'repair' ? 'start' : 'createship', speed = kind === 'repair' ? 'speedchange' : 'createship_speedchange';
    if (o.api === prefix + start || o.api === prefix + speed) {
      const complete = o.api === prefix + speed || num(o, 'api_highspeed') === 1;
      const subject = num(o, 'api_ship_id') || g[kind][slot]?.api_ship_id || 0;
      const repairMs = g.ships[subject]?.api_ndock_time;
      g[kind][slot] = { api_id: slot, api_state: complete ? kind === 'repair' ? 0 : 3 : kind === 'repair' ? 1 : 2,
        api_ship_id: subject, api_complete_time: !complete && kind === 'repair' && at && positive(repairMs) ? at + repairMs : 0 };
    }
    if (kind === 'build' && o.api === prefix + 'getship' && !Array.isArray(rows.build)) g.build[slot] = { api_id: slot, api_state: 0, api_complete_time: 0 };
  }
  return rows;
}
export const FATIGUE_CYCLE = 180000;
const SUPPLY_SHIP_IDS = [996, 1002];

export function portSupplyStatus(game, fleet) {
  const ids = fleet?.api_ship?.filter(id => id > 0) || [];
  if (!ids.length) {
    return {
      placed: false, supplied: false, undamaged: false, condOk: false, notAway: false,
      valid: false, boost: 0, shipId: null, isKai: false, reason: '所属艦なし'
    };
  }
  let supplyShip = null, supplyMaster = null;
  for (let i = 0; i < Math.min(2, ids.length); i++) {
    const s = game.ships[ids[i]];
    const m = game.shipMasters[s?.api_ship_id];
    if (SUPPLY_SHIP_IDS.includes(s?.api_ship_id)) {
      supplyShip = s;
      supplyMaster = m;
      break;
    }
  }
  if (!supplyShip) {
    return {
      placed: false, supplied: false, undamaged: false, condOk: false, notAway: false,
      valid: false, boost: 0, shipId: null, isKai: false, reason: '給糧艦未配置'
    };
  }
  const placed = true;
  const maxFuel = supplyMaster?.api_fuel_max ?? 35;
  const maxBull = supplyMaster?.api_bull_max ?? 15;
  const supplied = Number.isFinite(supplyShip.api_fuel) && Number.isFinite(supplyShip.api_bull)
    ? (supplyShip.api_fuel >= maxFuel && supplyShip.api_bull >= maxBull)
    : false;
  const undamaged = (supplyShip.api_nowhp * 4 > supplyShip.api_maxhp * 3);
  const condOk = (supplyShip.api_cond >= 30);
  const docked = Object.values(game.repair || {}).some(d => d.api_state > 0 && d.api_ship_id === supplyShip.api_id);
  const away = Boolean(game.away?.[fleet.api_id] || fleet.api_mission?.[0] !== 0);
  const notAway = !docked && !away;

  const valid = placed && supplied && undamaged && condOk && notAway;
  const isKai = supplyShip.api_ship_id === 1002;
  const boost = isKai ? 3 : 2;
  let reason = '給糧艦稼働中';
  if (!placed) reason = '給糧艦未配置';
  else if (!undamaged) reason = '給糧艦が小破以上（要修復）';
  else if (!supplied) reason = '給糧艦の補給不足（燃料・弾薬）';
  else if (!condOk) reason = '給糧艦の疲労（cond30未満）';
  else if (!notAway) reason = '給糧艦が入渠または遠征中';

  return {
    placed, supplied, undamaged, condOk, notAway,
    valid, boost, shipId: supplyShip.api_id, isKai, reason
  };
}

export function fatigueFor(game, fleet, target) {
  const pending = { state: 'pending', endAt: null, detail: { reason: '母港の情報待ち', target } };
  if (target === null) return { ...pending, detail: { reason: '目標未設定', target } };
  const ids = fleet?.api_ship?.filter(id => id > 0);
  if (!ids) return pending;
  if (!ids.length) return { state: 'empty', endAt: null, detail: { target } };
  if (!game.portReady || game.away[fleet.api_id] || fleet.api_mission?.[0] !== 0) return pending;
  const ships = ids.map(id => game.ships[id]);
  if (ships.some(s => !s || !Number.isInteger(s.api_cond) || s.api_cond < 0 || s.api_cond > 100 || !s.condAt || Object.values(game.repair).some(d => d.api_state > 0 && d.api_ship_id === s.api_id))) return pending;

  const minCond = Math.min(...ships.map(s => s.api_cond));
  const portSupply = portSupplyStatus(game, fleet);
  if (minCond >= target) return { state: 'complete', endAt: null, detail: { minCond, target, portSupply } };

  const baseAt = Math.max(...ships.map(s => s.condAt));
  const startAt = (portSupply.valid && game.portSupplyAt?.[fleet.api_id]) ? game.portSupplyAt[fleet.api_id] : baseAt;
  const simShips = ships.map(s => ({
    id: s.api_id,
    isSupplyShip: s.api_id === portSupply.shipId,
    cond: s.api_cond,
    shipTarget: !portSupply.valid ? Math.min(target, 49) : (s.api_id === portSupply.shipId ? Math.min(target, 49) : target)
  }));

  if (simShips.every(s => s.cond >= s.shipTarget)) {
    return { state: 'complete', endAt: null, detail: { startAt, minCond, target, portSupply, stoppedAt49: !portSupply.valid && target > 49 } };
  }

  let elapsedMinutes = 0;
  let reached = false;
  const STEP_MIN = 3;
  const MAX_MINUTES = 360;

  while (elapsedMinutes < MAX_MINUTES) {
    elapsedMinutes += STEP_MIN;
    for (const s of simShips) {
      if (s.cond < 49) s.cond = Math.min(49, s.cond + 3);
    }
    if (portSupply.valid && (elapsedMinutes % 15 === 0)) {
      for (const s of simShips) {
        if (!s.isSupplyShip && s.cond < 54) s.cond = Math.min(54, s.cond + portSupply.boost);
      }
    }
    if (simShips.every(s => s.cond >= s.shipTarget)) {
      reached = true;
      break;
    }
  }

  const endAt = reached ? startAt + elapsedMinutes * 60 * 1000 : null;
  return {
    state: reached ? 'active' : 'pending',
    endAt,
    detail: {
      startAt,
      minCond,
      target,
      cycleMs: FATIGUE_CYCLE,
      portSupply,
      simMinutes: elapsedMinutes,
      stoppedAt49: !portSupply.valid && target > 49
    }
  };
}

export const MIN_REPAIR = 1200000;
export function repairProgress(ship, startAt, now) {
  const missing = ship.maxHp - ship.hp;
  const actualRepairMs = Math.ceil(Math.max(0, ship.repairMs - 30000) / 60000) * 60000;
  const tickMs = Math.max(1, Math.ceil(actualRepairMs / missing));
  const perCycle = Math.max(1, Math.floor(MIN_REPAIR / tickMs));
  const totalCycles = Math.min(missing, Math.max(1, Math.ceil(tickMs * missing / MIN_REPAIR)));
  const cycles = Math.max(0, Math.floor((now - startAt) / MIN_REPAIR));
  const healed = cycles === 0 ? 0 : Math.min(missing, Math.max(cycles, Math.floor(cycles * MIN_REPAIR / tickMs)));
  const healedAt20 = Math.min(missing, Math.max(1, Math.floor(MIN_REPAIR / tickMs)));
  const finishAt = startAt + actualRepairMs;
  return { ...ship, actualRepairMs, finishAt, healedAt20, hpNow: ship.hp + healed, healed, perCycle, endAt: startAt + totalCycles * MIN_REPAIR };
}
export function akashiFor(game, fleet, now) {
  const pending = { state: 'pending', endAt: null, detail: { reason: '母港・装備情報待ち' } };
  if (!game.portReady || !fleet || !game.akashiAt[fleet.api_id] || game.away[fleet.api_id]) return pending;
  const ids = fleet.api_ship?.filter(id => id > 0) || [];
  const first = game.ships[ids[0]], master = game.shipMasters[first?.api_ship_id];
  const docked = id => Object.values(game.repair).some(d => d.api_state > 0 && d.api_ship_id === id);
  if (!ids.length) return { state: 'empty', endAt: null, detail: {} };
  if (!first || !master) return pending;
  if (master.api_stype !== 19 || first.api_nowhp * 2 <= first.api_maxhp || docked(first.api_id) || fleet.api_mission?.[0] !== 0) {
    return { state: 'empty', endAt: null, detail: {} };
  }
  if (!Array.isArray(first.api_slot)) return pending;
  let cranes = 0;
  for (const id of [...first.api_slot, first.api_slot_ex || -1].filter(id => id > 0)) {
    const gear = game.gears[id], type = game.gearMasters[gear?.api_slotitem_id]?.api_type?.[2];
    if (type === undefined) return pending;
    if (type === 31) cranes++;
  }
  const capacity = Math.min(6, 2 + cranes), ships = [];
  let timeMod = 1;
  if (ids.length >= 2) {
    const second = game.ships[ids[1]], secondMaster = game.shipMasters[second?.api_ship_id];
    if (second && secondMaster && secondMaster.api_stype === 19 && second.api_nowhp * 2 > second.api_maxhp && !docked(second.api_id)) {
      timeMod = 5 / 6;
    }
  }
  for (const id of ids.slice(0, capacity)) {
    const s = game.ships[id];
    if (!s || !Number.isSafeInteger(s.api_nowhp) || !Number.isSafeInteger(s.api_maxhp)) return pending;
    if (docked(id) || s.api_nowhp >= s.api_maxhp || s.api_nowhp * 4 <= s.api_maxhp) continue;
    if (!Number.isSafeInteger(s.api_ndock_time) || s.api_ndock_time <= 0) return pending;
    const repairMs = Math.floor(s.api_ndock_time * timeMod);
    ships.push(repairProgress({ id, name: game.shipMasters[s.api_ship_id]?.api_name || `艦ID ${id}`,
      hp: s.api_nowhp, maxHp: s.api_maxhp, repairMs }, game.akashiAt[fleet.api_id], now));
  }
  if (!ships.length) return { state: 'empty', endAt: null, detail: {} };
  const startAt = game.akashiAt[fleet.api_id];
  const endAt = Math.max(startAt + MIN_REPAIR, ...ships.map(s => s.finishAt));
  return { state: 'active', endAt,
    detail: { startAt, firstAt: startAt + MIN_REPAIR, cycleMs: MIN_REPAIR, timeMod, ships } };
}

export function targetFor(settings, slot) {
  return Object.hasOwn(settings.fatigueTargets, slot) ? settings.fatigueTargets[slot] : settings.fatigueTarget;
}
