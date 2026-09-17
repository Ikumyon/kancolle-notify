// 純粋な通信契約。抽出のみを行い、ゲーム状態やタイマーを計算しない。
const ship = { api_id: 0, api_ship_id: 0, api_nowhp: 0, api_maxhp: 0, api_cond: 0, api_ndock_time: 0, api_slot: [0], api_slot_ex: 0, api_fuel: 0, api_bull: 0 };
const fleet = { api_id: 0, api_name: '', api_ship: [0], api_mission: [0] };
const dock = { api_id: 0, api_state: 0, api_ship_id: 0, api_created_ship_id: 0, api_complete_time: 0 };
const gear = { api_id: 0, api_slotitem_id: 0 };
const data = { api_ship: [ship], api_ship_data: [ship], api_deck_port: [fleet], api_deck_data: [fleet],
  api_ndock: [dock], api_kdock: [dock], api_slot_item: [gear], api_complatetime: 0, api_mission: [0],
  api_mst_ship: [{ api_id: 0, api_name: '', api_stype: 0, api_ctype: 0, api_fuel_max: 0, api_bull_max: 0 }],
  api_mst_mission: [{ api_id: 0, api_name: '' }], api_mst_slotitem: [{ api_id: 0, api_type: [0] }] };
const arrays = { 'api_get_member/deck': fleet, 'api_get_member/ship2': ship, 'api_get_member/ndock': dock,
  'api_get_member/kdock': dock, 'api_get_member/slot_item': gear };
const known = new Set(['api_start2', 'api_start2/getData', 'api_port/port', ...Object.keys(arrays),
  'api_get_member/ship3', 'api_get_member/ship_deck', 'api_get_member/require_info', 'api_req_member/require_info',
  'api_req_mission/start', 'api_req_mission/result', 'api_req_mission/return_instruction',
  'api_req_nyukyo/start', 'api_req_nyukyo/speedchange', 'api_req_kousyou/createship',
  'api_req_kousyou/createship_speedchange', 'api_req_kousyou/getship', 'api_req_hensei/change',
  'api_req_hensei/preset_select', 'api_req_hokyu/charge', 'api_req_member/itemuse_cond',
  'api_req_kousyou/destroyship', 'api_req_kousyou/createitem', 'api_req_kousyou/destroyitem2', 'api_req_kousyou/remodel_slot']);
const fields = new Set(['api_id', 'api_ship_idx', 'api_deck_id', 'api_ndock_id', 'api_kdock_id',
  'api_ship_id', 'api_highspeed', 'api_mission_id', 'api_slot_idx', 'api_item_id', 'api_slotitem_ids']);
export function supported(api) {
  return known.has(api) || /^api_req_(map|sortie|battle_midnight|practice|combined_battle|kaisou)\/[a-z_]+$/.test(api);
}
export function apiName(value) {
  try { return new URL(value).pathname.match(/\/kcsapi\/(.+)$/)?.[1] || ''; } catch { return ''; }
}
function pick(value, schema) {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(schema)) {
    if (!Array.isArray(value)) throw new Error('invalid_array');
    return value.map(v => pick(v, schema[0]));
  }
  if (typeof schema === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_object');
    return Object.fromEntries(Object.entries(schema).filter(([k]) => value[k] !== undefined && value[k] !== null)
      .map(([k, s]) => [k, pick(value[k], s)]));
  }
  if (typeof schema === 'number' ? !Number.isSafeInteger(value) : typeof value !== 'string' || value.length > 200) throw new Error('invalid_value');
  return value;
}
export function parameters(request) {
  const post = request?.postData;
  const pairs = post?.params?.length ? post.params.map(p => [p.name, p.value]) : [...new URLSearchParams(post?.text || '')];
  return Object.fromEntries(pairs.filter(([k]) => fields.has(k)).map(([k, v]) => [k, String(v)]));
}
export function extract(api, body, request = {}, status = 200) {
  if (!supported(api)) throw new Error('unsupported_api');
  if (status !== 200) throw new Error('http_failure');
  const parsed = typeof body === 'string' ? JSON.parse(body.replace(/^\s*svdata=/, '')) : body;
  if (parsed?.api_result !== 1) throw new Error('game_failure');
  const schema = arrays[api] ? [arrays[api]] : api === 'api_req_hensei/preset_select' ? fleet
    : api === 'api_req_kousyou/getship' ? { api_ship: ship, api_kdock: [dock], api_slotitem: [gear] }
    : api === 'api_req_kousyou/createitem' ? { api_slot_item: gear } : data;
  const response = { api_result: 1 };
  if (parsed.api_data !== undefined && parsed.api_data !== null) response.api_data = pick(parsed.api_data, schema);
  if (parsed.api_data_deck !== undefined) response.api_data_deck = pick(parsed.api_data_deck, [fleet]);
  const cleanRequest = {};
  for (const [key, value] of Object.entries(request)) {
    if (fields.has(key) && typeof value === 'string' && value.length <= 500) cleanRequest[key] = value;
  }
  return { request: cleanRequest, response };
}
// 元APIのフィールドをカテゴリへ並べるだけ。状態判定・予測はしない。
export function observationRows(api, response) {
  const d = response.api_data;
  return {
    ships: api === 'api_get_member/ship2' ? d : api === 'api_req_kousyou/getship' && d?.api_ship ? [d.api_ship]
      : d?.api_ship_data ?? (Array.isArray(d?.api_ship) && typeof d.api_ship[0] === 'object' ? d.api_ship : undefined),
    fleets: api === 'api_get_member/deck' ? d : response.api_data_deck ?? d?.api_deck_port ?? d?.api_deck_data
      ?? (api === 'api_req_hensei/preset_select' ? [d] : undefined),
    repair: api === 'api_get_member/ndock' ? d : d?.api_ndock,
    build: api === 'api_get_member/kdock' ? d : d?.api_kdock,
    gears: api === 'api_get_member/slot_item' ? d : api === 'api_req_kousyou/getship' ? d?.api_slotitem
      : api === 'api_req_kousyou/createitem' && d?.api_slot_item ? [d.api_slot_item] : d?.api_slot_item,
    shipMasters: d?.api_mst_ship, missionMasters: d?.api_mst_mission, gearMasters: d?.api_mst_slotitem
  };
}
