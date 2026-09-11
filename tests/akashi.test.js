import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { repairProgress, repairLine, MIN_REPAIR } from '../extension/core/akashi.js';
import { Parser } from '../extension/core/parser.js';
import { emptyState, observe, claimDelivery, finishDelivery, formatDelivery, validateObservation } from '../extension/core/state.js';
import { beginSession } from '../extension/core/generation.js';
const at = 1800000000000;
const ships = [{ id: 1, name: '明石改', hp: 35, max: 37, repair: 1230000, mod: 1 },
  { id: 2, name: '吹雪改二', hp: 28, max: 36, repair: 2730000, mod: 1 }];
const event = () => ({ kind: 'akashi', slot: 1, action: 'snapshot', state: 'active', end: at + MIN_REPAIR, subject: at, name: '', repair: { start: at, ships: structuredClone(ships) } });
test('HP and completion boundaries match the local KC3 implementation, including minimum one HP', () => {
  const source = readFileSync(new URL('../../kc3kai-release/library/objects.js', import.meta.url), 'utf8');
  const start = source.indexOf('const a=1e3,b=60*a;window.KC3AkashiRepair');
  const end = source.indexOf('}}();', start);
  assert.ok(start >= 0 && end > start);
  const context = { window: {}, localStorage: { getItem() {} }, Date, Math, Number }; context.window = context;
  vm.runInNewContext('!function(){"use strict";' + source.slice(start, end + 5), context);
  const kc = context.KC3AkashiRepair;
  for (const missing of [1, 2, 7, 20]) for (const repair of [31000, 1230000, 2730000, 9000000]) for (const mod of [1, 0.85]) {
    const s = { ...ships[0], hp: 30, max: 30 + missing, repair, mod };
    for (const elapsed of [0, MIN_REPAIR - 1, MIN_REPAIR, MIN_REPAIR + 1, 1800000, 9000000]) {
      const delta = { ms: () => elapsed };
      const expected = elapsed < MIN_REPAIR ? 0 : kc.calculateProgress(delta, kc.calculateTickLength(kc.calculateRepairTime(repair, mod), missing), missing).repairedHp;
      assert.equal(repairProgress(s, at, at + elapsed).healed, expected);
    }
    const complete = repairProgress(s, at, at).end;
    assert.equal(repairProgress(s, at, complete).hp, s.max);
    assert.ok(repairProgress(s, at, complete - 1).hp < s.max);
  }
});
test('20 minutes and individual completion notify once; intermediate HP does not notify', () => {
  const s = emptyState(), ticket = beginSession(s, 'play', 'pc', at);
  observe(s, { ...ticket, seq: 1, events: [event()], errors: [] }, 'pc', at);
  assert.equal(claimDelivery(s, at + MIN_REPAIR - 1, 'early'), null);
  const d = claimDelivery(s, at + MIN_REPAIR, 'first');
  assert.deepEqual(d.items[0].milestones, ['start', '1']);
  assert.match(formatDelivery(d), /明石改: 35->37 \+2　全回復/);
  assert.match(formatDelivery(d), /吹雪改二: 28->31 \+3　あと25分/);
  finishDelivery(s, 'first', at + MIN_REPAIR, { ok: true });
  assert.equal(claimDelivery(s, at + 1800000, 'middle'), null);
  const full = claimDelivery(s, at + 2700000, 'full');
  assert.deepEqual(full.items[0].milestones, ['2']);
  assert.match(formatDelivery(full), /吹雪改二: 28->36 \+8　全回復/);
  finishDelivery(s, 'full', at + 2700000, { ok: true });
  assert.equal(claimDelivery(s, at + 9900000, 'done'), null);
  assert.match(repairLine(ships[1], at, at + MIN_REPAIR), /28->31/);
});
test('cancellation, stale observations, delayed delivery and retry retain correct milestones', () => {
  const s = emptyState(), ticket = beginSession(s, 'play', 'pc', at);
  const input = { ...ticket, seq: 1, events: [event()], errors: [] };
  observe(s, input, 'pc', at);
  let d = claimDelivery(s, at + MIN_REPAIR, 'fail');
  finishDelivery(s, 'fail', at + MIN_REPAIR, { ok: false, uncertain: true });
  d = claimDelivery(s, at + 3000000, 'retry');
  assert.deepEqual(d.items[0].milestones, ['start', '1', '2']);
  assert.match(formatDelivery(d), /吹雪改二: 28->36/);
  observe(s, { ...input, seq: 2, events: [{ ...event(), repair: null, subject: null, end: null, state: 'pending', name: '情報待ち' }] }, 'pc', at + 3000001);
  assert.equal(observe(s, input, 'pc', at).status, 'duplicate');
  assert.equal(claimDelivery(s, at + 4000000, 'cancelled'), null);
  assert.equal(validateObservation({ ...input, events: [{ ...event(), repair: { start: at, ships: [{ ...ships[0], hp: 50 }] } }] }), false);
});
function fixture() {
  const parser = new Parser();
  const parse = (api, data, p = {}, time = at) => parser.parse(api, { api_result: 1, api_data: data }, p, 200, time);
  parse('api_start2/getData', { api_mst_ship: [{ api_id: 187, api_stype: 19, api_ctype: 49, api_name: '明石改' }, { api_id: 1, api_stype: 2, api_ctype: 1, api_name: '吹雪改二' }], api_mst_slotitem: [{ api_id: 86, api_type: [0, 0, 31] }] });
  parse('api_get_member/slot_item', [{ api_id: 100, api_slotitem_id: 86 }]);
  const port = { api_ship: ships.map((s, i) => ({ api_id: s.id, api_ship_id: i ? 1 : 187, api_nowhp: s.hp, api_maxhp: s.max, api_ndock_time: s.repair, api_slot: i ? [] : [100], api_cond: 49 })),
    api_deck_port: [{ api_id: 1, api_ship: [1], api_mission: [0, 0, 0] }], api_ndock: [] };
  parse('api_port/port', port);
  return { parser, parse, port };
}
test('passive tracker requires observed start, preserves preset/bulk timer, invalidates changed equipment and combat', () => {
  const { parse, port } = fixture();
  assert.match(parse('api_port/port', port).akashi[0].name, /未計測/);
  const started = parse('api_req_hensei/change', {}, { api_id: 1, api_ship_idx: 1, api_ship_id: 2 }).akashi[0];
  assert.equal(started.state, 'active'); assert.equal(started.repair.ships.length, 2);
  const preset = { api_id: 1, api_ship: [1, 2], api_mission: [0, 0, 0] };
  assert.equal(parse('api_req_hensei/preset_select', preset, { api_deck_id: 1 }, at + 60000).akashi[0].repair.start, at);
  assert.equal(parse('api_req_hensei/change', {}, { api_id: 1, api_ship_idx: 1, api_ship_id: -2 }, at + 120000).akashi[0].repair.start, at);
  assert.equal(parse('api_req_kaisou/slotset', {}, {}, at + 180000).akashi[0].state, 'pending');
  assert.equal(parse('api_port/port', port, {}, at + 200000).akashi[0].name, '開始時刻未計測');
  assert.equal(parse('api_req_combined_battle/each_battle', {}, {}, at + 210000).akashi[0].state, 'pending');
});
test('repair capacity, damage boundary, docks and second repair ship modifier are observed', () => {
  const { parse, port } = fixture();
  const provider = { ...port.api_ship[0], api_id: 3, api_nowhp: 37 };
  const half = { ...port.api_ship[1], api_id: 4, api_nowhp: 18 };
  const outside = { ...port.api_ship[1], api_id: 5 };
  const value = { ...port, api_ship: [...port.api_ship, provider, half, outside], api_deck_port: [{ api_id: 1, api_ship: [1, 3, 2, 4, 5], api_mission: [0, 0, 0] }] };
  parse('api_port/port', value);
  let e = parse('api_req_hensei/change', {}, { api_id: 1, api_ship_idx: 0, api_ship_id: 1 }).akashi[0];
  assert.equal(e.state, 'active');
  assert.deepEqual(e.repair.ships.map(s => s.id), [1, 2, 5]);
  assert.ok(e.repair.ships.every(s => s.mod === 0.85));
  value.api_ship = value.api_ship.filter(s => s.api_id !== 3);
  value.api_deck_port[0].api_ship = [1, 2, 4, 5];
  parse('api_port/port', value);
  e = parse('api_req_hensei/change', {}, { api_id: 1, api_ship_idx: 0, api_ship_id: 1 }).akashi[0];
  assert.deepEqual(e.repair.ships.map(s => s.id), [1, 2]); // capacity 3, half-HP ship excluded
  value.api_ndock = [{ api_id: 1, api_state: 1, api_ship_id: 2 }];
  e = parse('api_port/port', value, {}, at + MIN_REPAIR).akashi[0];
  assert.deepEqual(e.repair.ships.map(s => s.id), [1]);
  assert.equal(e.repair.start, at + MIN_REPAIR);
  assert.equal(parse('api_get_member/slot_item', [], {}, null).akashi[0].state, 'pending');
});
