// Passive observations only. All times are milliseconds from response Date.
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
export const invalidatesRepair = api => /^api_req_(map|sortie|battle_midnight|practice|combined_battle|kaisou)\//.test(api) || ['api_req_kousyou/destroyship', 'api_req_kousyou/remodel_slot'].includes(api);
export const akashiApis = new Set(['api_get_member/slot_item', 'api_req_kaisou/slotset', 'api_req_kaisou/slotset_ex',
  'api_req_kaisou/unsetslot_all', 'api_req_kaisou/slot_exchange_index', 'api_req_kaisou/slot_deprive',
  'api_req_kousyou/createitem', 'api_req_kousyou/destroyitem2', 'api_req_kousyou/remodel_slot']);
export class AkashiTracker {
  constructor() { this.masters = {}; this.gearMasters = {}; this.reset(); }
  reset() { this.gears = {}; this.ships = {}; this.start = null; this.previous = {}; this.dirty = false; }
  apply(api, b, p, at, base) {
    const d = b.api_data;
    if (api.startsWith('api_start2')) this.reset();
    if (Array.isArray(d?.api_mst_ship)) this.masters = Object.fromEntries(d.api_mst_ship.map(m => [m.api_id, { type: m.api_stype, class: m.api_ctype, name: m.api_name }]));
    if (Array.isArray(d?.api_mst_slotitem)) this.gearMasters = Object.fromEntries(d.api_mst_slotitem.map(m => [m.api_id, m.api_type?.[2]]));
    const gear = api === 'api_get_member/slot_item' ? d : d?.api_slot_item;
    if (Array.isArray(gear)) this.gears = Object.fromEntries(gear.map(g => [g.api_id, g.api_slotitem_id]));
    const rows = api === 'api_port/port' ? d?.api_ship : api === 'api_get_member/ship2' ? d : d?.api_ship_data;
    if (Array.isArray(rows)) {
      if (api === 'api_port/port' || api === 'api_get_member/ship2') this.ships = {};
      for (const r of rows) if (positive(r.api_id)) this.ships[r.api_id] = { ...this.ships[r.api_id],
        ...(Array.isArray(r.api_slot) ? { slots: [...r.api_slot, ...(r.api_slot_ex > 0 ? [r.api_slot_ex] : [])] } : {}),
        ...(Number.isSafeInteger(r.api_ndock_time) ? { repair: r.api_ndock_time } : {}) };
    }
    if (invalidatesRepair(api) || akashiApis.has(api) && api !== 'api_get_member/slot_item') { this.dirty = true; this.start = null; }
    if (['api_req_kousyou/remodel_slot', 'api_req_kousyou/destroyitem2'].includes(api)) this.gears = {};
    if (api === 'api_port/port' && Array.isArray(rows)) this.dirty = !rows.every(r => positive(r.api_id) && positive(r.api_ship_id) && Number.isSafeInteger(r.api_nowhp) && positive(r.api_maxhp) && Number.isSafeInteger(r.api_ndock_time) && Array.isArray(r.api_slot));
    if (!positive(at) || base.needsPort) { this.start = null; this.dirty = true; }
    const info = id => {
      const s = base.ships[id], m = this.masters[s?.master], extra = this.ships[id];
      const facilities = extra?.slots?.reduce((n, g) => g <= 0 ? n : this.gearMasters[this.gears[g]] === undefined ? NaN : n + (this.gearMasters[this.gears[g]] === 31 ? 1 : 0), 0);
      return { s, m, extra, facilities, repairShip: m?.type === 19 && (m.class === 49 || facilities > 0),
        free: s && s.hp * 2 > s.maxhp && !base.docks.includes(id) };
    };
    const has = f => info(f?.ships[0]).repairShip;
    const fleets = base.fleets;
    const changed = Object.entries(fleets).filter(([id, f]) => JSON.stringify(f.ships) !== JSON.stringify(this.previous[id])).map(([, f]) => f);
    if (!this.dirty && api === 'api_req_hensei/change' && p.api_ship_id !== -2 && !d?.api_change_count && [...changed, fleets[p.api_id]].filter(Boolean).some(has)) this.start = at;
    if (!this.dirty && api === 'api_req_hensei/preset_select' && !this.start && has(fleets[p.api_deck_id])) this.start = at;
    if (!this.dirty && api === 'api_port/port' && this.start && at - this.start >= MIN_REPAIR) this.start = Object.values(fleets).some(has) ? at : null;
    this.previous = Object.fromEntries(Object.entries(fleets).map(([k, f]) => [k, [...f.ships]]));
    return [1, 2, 3, 4].map(slot => {
      const e = { kind: 'akashi', slot, action: 'snapshot', state: 'pending', end: null, subject: null, name: '', repair: null };
      const pending = name => ({ ...e, name });
      const f = fleets[slot];
      if (!f || this.dirty || !base.docksKnown) return pending('母港の情報待ち');
      if (!f.ships.length) return { ...e, state: 'empty', name: '修理対象なし' };
      if (f.away) return pending('遠征中');
      const first = info(f.ships[0]), second = info(f.ships[1]);
      if (!first.m) return pending('艦情報待ち');
      if (first.m.type === 19 && (!Number.isFinite(first.facilities) || second.s && (!second.m || second.m.type === 19 && !Number.isFinite(second.facilities)))) return pending('装備・艦情報待ち');
      if (!first.repairShip || !first.free) return { ...e, state: 'empty', name: '修理対象なし' };
      if (!Number.isFinite(first.facilities) || second.repairShip && !Number.isFinite(second.facilities)) return pending('装備情報待ち');
      const capacity = [first, second].reduce((n, x) => n + (x.repairShip && x.free ? x.facilities + (x.m.class === 49 ? 2 : 0) : 0), 0);
      const mod = first.repairShip && second.repairShip ? 0.85 : 1;
      const ships = [];
      for (const id of f.ships.slice(0, capacity)) {
        const x = info(id);
        if (!x.s || !x.m || !x.extra) return pending('艦情報待ち');
        if (x.free && x.s.hp < x.s.maxhp) ships.push({ id, name: String(x.m.name || `艦${id}`).slice(0, 80), hp: x.s.hp, max: x.s.maxhp, repair: x.extra.repair, mod });
      }
      if (!ships.length) return { ...e, state: 'empty', name: '修理対象なし' };
      if (!this.start) return pending('開始時刻未計測');
      const repair = { start: this.start, ships };
      if (!validRepair(repair)) return pending('修理時間の情報待ち');
      return { ...e, state: 'active', end: this.start + MIN_REPAIR, subject: this.start, repair };
    });
  }
}
