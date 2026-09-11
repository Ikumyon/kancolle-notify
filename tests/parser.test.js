import test from 'node:test';
import assert from 'node:assert/strict';
import { Parser, apiName, parameters } from '../extension/core/parser.js';
const wrap = data => 'svdata=' + JSON.stringify({ api_result: 1, api_data: data });
test('fleet snapshots use each actual response topology, and partial responses leave absent fleets alone', () => {
  const p = new Parser(), deck = [{ api_id: 2, api_mission: [1, 5, 1800000000000] }];
  for (const [api, body] of [
    ['api_get_member/deck', wrap(deck)],
    ['api_get_member/ship2', { api_result: 1, api_data: [], api_data_deck: deck }],
    ['api_get_member/ship3', wrap({ api_ship_data: [], api_deck_data: deck })],
    ['api_get_member/ship_deck', wrap({ api_ship_data: [], api_deck_data: deck })]
  ]) {
    const result = p.parse(api, body); assert.equal(result.events.length, 1); assert.equal(result.events[0].end, 1800000000000); assert.deepEqual(result.errors, []);
  }
});
test('return instruction changes its fleet, start never invents an end time', () => {
  const p = new Parser();
  assert.equal(p.parse('api_req_mission/return_instruction', wrap({ api_mission: [2, 5, 1800000000000] }), { api_deck_id: 3 }).events[0].action, 'change');
  const start = p.parse('api_req_mission/start', wrap({}), { api_deck_id: 2, api_mission_id: 5 }).events[0];
  assert.equal(start.state, 'pending'); assert.equal(start.end, null);
});
test('repair names are resolved only from observed master/ship data', () => {
  const p = new Parser();
  p.parse('api_start2/getData', wrap({ api_mst_ship: [{ api_id: 10, api_name: '睦月' }] }));
  const r = p.parse('api_port/port', wrap({ api_ship: [{ api_id: 100, api_ship_id: 10 }], api_deck_port: [],
    api_ndock: [{ api_id: 1, api_state: 1, api_ship_id: 100, api_complete_time: 1800000000000 }] }));
  assert.equal(r.events[0].name, '睦月');
  assert.equal(p.parse('api_req_nyukyo/speedchange', wrap({}), { api_ndock_id: 1 }).events[0].state, 'complete');
});
test('build snapshot, acceleration and receipt do not use client clock', () => {
  const p = new Parser();
  const r = p.parse('api_get_member/require_info', wrap({ api_kdock: [{ api_id: 1, api_state: 2, api_complete_time: 1800000000000, api_created_ship_id: 999 }] }));
  assert.equal(r.events[0].subject, null); assert.ok(!JSON.stringify(r).includes('999'));
  assert.equal(p.parse('api_req_kousyou/createship_speedchange', wrap({}), { api_kdock_id: 1 }).events[0].end, null);
  assert.equal(p.parse('api_req_kousyou/getship', wrap({ api_kdock: [{ api_id: 1, api_state: 0, api_complete_time: 0 }] })).events[0].state, 'empty');
});
test('build ship name resolution honors hideBuildName flag', () => {
  const p = new Parser();
  p.parse('api_start2/getData', wrap({ api_mst_ship: [{ api_id: 131, api_name: '大和' }] }));
  
  // hideBuildName = true (default): name is omitted
  assert.equal(p.hideBuildName, true);
  const rHidden = p.parse('api_get_member/kdock', wrap([{ api_id: 1, api_state: 2, api_complete_time: 1800000000000, api_created_ship_id: 131 }]));
  assert.equal(rHidden.events[0].name, undefined);

  // hideBuildName = false: name is resolved and included
  p.hideBuildName = false;
  const rShown = p.parse('api_get_member/kdock', wrap([{ api_id: 1, api_state: 2, api_complete_time: 1800000000000, api_created_ship_id: 131 }]));
  assert.equal(rShown.events[0].name, '大和');
});
test('expedition name resolves from builtin map and dynamic api_mst_mission', () => {
  const p = new Parser();
  // 1. Builtin mission resolution (e.g. ID 5 -> 海上護衛任務) even without api_start2
  const rDeck = p.parse('api_get_member/deck', wrap([{ api_id: 2, api_mission: [1, 5, 1800000000000] }]));
  assert.equal(rDeck.events[0].kind, 'expedition');
  assert.equal(rDeck.events[0].slot, 2);
  assert.equal(rDeck.events[0].name, '海上護衛任務');

  // 2. Dynamic mission registration via api_start2 (e.g. custom/new ID 999 -> 新規遠征)
  p.parse('api_start2/getData', wrap({ api_mst_mission: [{ api_id: 999, api_name: '特別深海掃討作戦' }] }));
  const rDynamic = p.parse('api_get_member/deck', wrap([{ api_id: 3, api_mission: [1, 999, 1800000000000] }]));
  assert.equal(rDynamic.events[0].name, '特別深海掃討作戦');

  // 3. Operation start (api_req_mission/start)
  const rStart = p.parse('api_req_mission/start', wrap({}), { api_deck_id: 2, api_mission_id: 5 });
  assert.equal(rStart.events[0].name, '海上護衛任務');
});
test('malformed, failed and unknown state responses never produce cancellations', () => {
  const p = new Parser();
  for (const [body, status] of [['broken', 200], ['svdata={"api_result":0}', 200], [wrap([]), 500], [wrap([{ api_id: 1, api_state: 8 }]), 200]]) {
    const r = p.parse('api_get_member/ndock', body, {}, status); assert.equal(r.events.length, 0); assert.ok(r.errors.length);
  }
  const r = p.parse('api_get_member/deck', wrap([{ api_id: 2, api_mission: [1, 5, 0] }]));
  assert.equal(r.events.length, 0); assert.ok(r.errors.length);
});
test('request allow list drops tokens and handles proxy paths', () => {
  assert.deepEqual(parameters({ postData: { text: 'api_token=SECRET&api_deck_id=2' } }), { api_deck_id: 2 });
  assert.equal(apiName('http://localhost/https/game.example/kcsapi/api_get_member/deck?x=1'), 'api_get_member/deck');
  assert.equal(apiName('invalid'), '');
});
