import test from 'node:test';
import assert from 'node:assert/strict';
import { Parser } from '../extension/core/parser.js';
import { fatigueEvents, fatigueSettings, emptyFatigueSettings, fleetMinCond } from '../extension/core/fatigue.js';
import { emptyState, observe, claimDelivery, finishDelivery, formatDelivery } from '../extension/core/state.js';
import { beginSession } from '../extension/core/generation.js';
import { visibleReservation, remainingText } from '../extension/core/display.js';
const now = 1800000000000;
const settings = target => fatigueSettings({ presets: [target], defaultTarget: target, fleets: {} });
const ship = (id, cond, master = id) => ({ api_id: id, api_ship_id: master, api_cond: cond, api_fuel: 10, api_bull: 10, api_nowhp: 10, api_maxhp: 10 });
function port(ships, fleets = [[1, 2]]) { return { api_result: 1, api_data: {
  api_ship: ships, api_deck_port: fleets.map((ids, i) => ({ api_id: i + 1, api_ship: ids, api_mission: [0, 0, 0] })),
  api_ndock: [], api_material: [{ api_id: 1, api_value: 1000 }] } }; }
test('settings supply all choices; natural estimate is stable and game transitions cancel stale timers', () => {
  assert.deepEqual(emptyFatigueSettings().presets, []);
  assert.equal(emptyFatigueSettings().defaultTarget, null);
  assert.throws(() => settings(101));
  assert.throws(() => fatigueSettings({ presets: [12, 12], defaultTarget: 12 }));
  const p = new Parser(), data = port([ship(1, 35), ship(2, 38)]);
  const a = p.parse('api_port/port', data, {}, 200, now);
  const e = fatigueEvents(a.fatigue, settings(41))[0];
  assert.equal(e.end, now + 360000);
  assert.equal(fatigueEvents(a.fatigue, emptyFatigueSettings())[0].state, 'pending');
  assert.equal(fatigueEvents(p.parse('api_port/port', data, {}, 200, now + 60000).fatigue, settings(41))[0].end, e.end);
  const away = p.parse('api_req_map/start', { api_result: 1, api_data: {} }, {}, 200, now + 90000);
  assert.equal(fatigueEvents(away.fatigue, settings(41))[0].state, 'pending');
  const back = p.parse('api_port/port', data, {}, 200, now + 180000);
  assert.equal(fatigueEvents(back.fatigue, settings(41))[0].end, now + 540000);
  assert.equal(fatigueEvents(p.parse('api_port/port', data).fatigue, settings(41))[0].state, 'pending');
});
test('feeding shares a timer, excludes provider, handles bulk/preset exceptions and unavailable conditions', () => {
  const p = new Parser();
  p.parse('api_start2/getData', { api_result: 1, api_data: { api_mst_ship: [{ api_id: 996, api_fuel_max: 10, api_bull_max: 10 }] } }, {}, 200, now);
  const data = port([ship(1, 30, 996), ship(2, 49), ship(3, 30, 996), ship(4, 49)], [[1, 2], [3, 4]]);
  const initial = p.parse('api_port/port', data, {}, 200, now);
  assert.match(fatigueEvents(initial.fatigue, settings(54))[0].name, /未計測/);
  const changed = p.parse('api_req_hensei/change', { api_result: 1 }, { api_id: 1, api_ship_idx: 1, api_ship_id: 2 }, 200, now);
  const events = fatigueEvents(changed.fatigue, settings(54));
  assert.equal(events[0].end, now + 2700000); assert.equal(events[1].end, events[0].end);
  const preset = p.parse('api_req_hensei/preset_select', { api_result: 1, api_data: data.api_data.api_deck_port[1] }, {}, 200, now + 1000);
  assert.equal(preset.fatigue.feedingAt, now);
  const bulk = p.parse('api_req_hensei/change', { api_result: 1, api_data: { api_change_count: 1 } }, { api_id: 1 }, 200, now + 2000);
  assert.equal(bulk.fatigue.feedingAt, now);
  assert.deepEqual(bulk.fatigue.fleets[1].ships, [1]);
  const copy = structuredClone(changed.fatigue); copy.fuel = 0;
  assert.equal(fatigueEvents(copy, settings(54))[0].state, 'pending');
  copy.fuel = 1000; copy.ships[1].supplied = false;
  assert.equal(fatigueEvents(copy, settings(54))[0].state, 'pending');
  assert.match(fatigueEvents(changed.fatigue, settings(60))[0].name, /到達不可/);
});
test('fatigue observations deliver once, correct invalidated estimates, and display uses the current activity', () => {
  const p = new Parser(), e = fatigueEvents(p.parse('api_port/port', port([ship(1, 35), ship(2, 38)]), {}, 200, now).fatigue, settings(41))[0];
  const s = emptyState(), ticket = beginSession(s, 'session', 'pc', now);
  observe(s, { ...ticket, seq: 1, events: [e], errors: [] }, 'pc', now);
  assert.equal(claimDelivery(s, e.end - 1, 'a'), null);
  const delivery = claimDelivery(s, e.end, 'b');
  assert.match(formatDelivery(delivery), /疲労回復見込み 第1艦隊/);
  assert.match(formatDelivery(delivery), /母港/);
  finishDelivery(s, 'b', e.end, { ok: true });
  assert.equal(claimDelivery(s, e.end + 60000, 'c'), null);
  assert.equal(visibleReservation(s.slots['fatigue:1']), false);
  observe(s, { ...ticket, seq: 2, events: [{ ...e, state: 'pending', end: null, name: '母港の情報待ち' }], errors: [] }, 'pc', e.end + 1);
  assert.equal(claimDelivery(s, e.end + 1, 'd').items[0].type, 'correction');
  assert.equal(visibleReservation({ state: 'active', generation: 2, sent: { generation: 1 } }), true);
  assert.equal(remainingText(now + 61000, now), 'あと2分');
  assert.equal(remainingText(now, now), '予定時刻到達');
});
test('fleetMinCond computes minimum condition for fleet ships or null if unavailable', () => {
  const snapshot = {
    fleets: {
      1: { ships: [1, 2, 3] },
      2: { ships: [4] },
      3: { ships: [] }
    },
    ships: {
      1: { cond: 49 },
      2: { cond: 32 },
      3: { cond: 53 },
      4: { cond: 40 }
    }
  };
  assert.equal(fleetMinCond(snapshot, 1), 32);
  assert.equal(fleetMinCond(snapshot, 2), 40);
  assert.equal(fleetMinCond(snapshot, 3), null);
  assert.equal(fleetMinCond(snapshot, 4), null);
  assert.equal(fleetMinCond(null, 1), null);
  assert.equal(fleetMinCond({ fleets: { 1: { ships: [99] } }, ships: {} }, 1), null);
});

