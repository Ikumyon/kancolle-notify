// Pure, allow-listed normalization. No network access, KC3 globals, or raw logging.
import { AkashiTracker, akashiApis, invalidatesRepair } from './akashi.js';
import { fatigueApis, FatigueTracker } from './fatigue.js';
const fleetApis = new Map([
  ['api_port/port', b => b.api_data?.api_deck_port],
  ['api_get_member/deck', b => b.api_data],
  ['api_get_member/ship2', b => b.api_data_deck],
  ['api_get_member/ship3', b => b.api_data?.api_deck_data],
  ['api_get_member/ship_deck', b => b.api_data?.api_deck_data]
]);
const repairApis = new Map([
  ['api_port/port', b => b.api_data?.api_ndock], ['api_get_member/ndock', b => b.api_data]
]);
const buildApis = new Map([
  ['api_get_member/kdock', b => b.api_data],
  ['api_get_member/require_info', b => b.api_data?.api_kdock],
  ['api_req_member/require_info', b => b.api_data?.api_kdock],
  ['api_req_kousyou/getship', b => b.api_data?.api_kdock]
]);
const operations = {
  'api_req_mission/start': ['expedition', 'api_deck_id', 'start'],
  'api_req_mission/result': ['expedition', 'api_deck_id', 'complete'],
  'api_req_mission/return_instruction': ['expedition', 'api_deck_id', 'change'],
  'api_req_nyukyo/start': ['repair', 'api_ndock_id', 'start'],
  'api_req_nyukyo/speedchange': ['repair', 'api_ndock_id', 'complete'],
  'api_req_kousyou/createship': ['build', 'api_kdock_id', 'start'],
  'api_req_kousyou/createship_speedchange': ['build', 'api_kdock_id', 'complete']
};
export function apiName(url) {
  try {
    const path = new URL(url).pathname;
    const pos = path.indexOf('/kcsapi/');
    return pos < 0 ? '' : path.slice(pos + 8);
  } catch { return ''; }
}
export function supported(api) {
  return invalidatesRepair(api) || akashiApis.has(api) || fleetApis.has(api) || repairApis.has(api) || buildApis.has(api) || fatigueApis.has(api) || Object.hasOwn(operations, api)
    || ['api_start2', 'api_start2/getData'].includes(api);
}
const integer = n => Number.isSafeInteger(n);
const time = n => integer(n) && n > 0;
const slot = (n, kind) => integer(n) && n >= (kind === 'expedition' ? 2 : 1) && n <= 4;
const defaultMissions = new Map([
  [1, '練習航海'], [2, '長距離練習航海'], [3, '警備任務'], [4, '対潜警戒任務'], [5, '海上護衛任務'],
  [6, '防空射撃演習'], [7, '観艦式予行'], [8, '観艦式'], [9, 'タンカー護衛任務'], [10, '強行偵察任務'],
  [11, 'ボーキサイト輸送任務'], [12, '資源輸送任務'], [13, '鼠輸送作戦'], [14, '包囲陸戦隊撤収作戦'],
  [15, '囮機動部隊支援作戦'], [16, '艦隊決戦支援作戦'], [17, '敵地偵察作戦'], [18, '航空機輸送作戦'],
  [19, '北号作戦'], [20, '潜水艦哨戒任務'], [21, '北方鼠輸送作戦'], [22, '艦隊総演習'], [23, '航空戦艦運用演習'],
  [24, '北方航路海上護衛'], [25, '通商破壊作戦'], [26, '敵母港空襲作戦'], [27, '潜水艦通商破壊作戦'],
  [28, '西方海域封鎖作戦'], [29, '潜水艦派遣演習'], [30, '潜水艦派遣作戦'], [31, '潜水艦後続支援任務'],
  [32, '遠洋練習航海'], [33, '前衛支援任務'], [34, '決戦支援任務'], [35, 'MO作戦'], [36, '水上機基地建設'],
  [37, '東京急行'], [38, '東京急行(弐)'], [39, '遠洋潜水艦作戦'], [40, '水上機前線輸送'], [41, 'ブルネイ泊地沖哨戒'],
  [42, 'ミ船団護衛(一号船団)'], [43, 'ミ船団護衛(二号船団)'], [44, '航空装備輸送任務'], [45, 'ボーキサイト船団護衛'],
  [46, '南西諸島離島哨戒作戦'],
  [100, '兵站強化任務'], [101, '海峡警備行動'], [102, '長時間対潜警戒'], [103, '南西方面連絡線哨戒'],
  [104, '小笠原沖哨戒線'], [105, '小笠原沖戦闘哨戒'], [110, '南西方面航空偵察作戦'], [111, '敵泊地強襲反撃作戦'],
  [112, '南西諸島離島防空作戦'], [113, '精鋭複葉機飛行隊'], [114, '小笠原諸島救難展開'], [115, '北方航路哨戒'],
  [116, '小笠原諸島哨戒線強化'], [131, '西方海域偵察作戦'], [132, '西方潜水艦作戦'], [133, '欧州方面友軍との接触'],
  [141, 'ラバウル方面展開'], [142, '強行鼠輸送作戦']
]);

export function parameters(request) {
  const allowed = new Set(['api_id', 'api_ship_idx', 'api_deck_id', 'api_ndock_id', 'api_kdock_id', 'api_ship_id', 'api_highspeed', 'api_mission_id']);
  const data = request?.postData;
  const pairs = data?.params?.map(p => [p.name, p.value]) ?? [...new URLSearchParams(data?.text || '')];
  return Object.fromEntries(pairs.filter(([k]) => allowed.has(k)).map(([k, v]) => [k, Number(v)]));
}
export class Parser {
  constructor() {
    this.ships = new Map();
    this.names = new Map();
    this.missions = new Map(defaultMissions);
    this.fatigue = new FatigueTracker();
    this.akashi = new AkashiTracker();
    this.hideBuildName = true;
  }
  parse(api, body, params = {}, status = 200, observedAt = null) {
    if (!supported(api)) return { events: [], errors: [] };
    if (status !== 200) return { events: [], errors: ['http_failure'] };
    let b;
    try { b = typeof body === 'string' ? JSON.parse(body.replace(/^[\s\S]*?svdata=/, '')) : body; }
    catch { return { events: [], errors: ['invalid_json'] }; }
    if (!b || b.api_result !== 1) return { events: [], errors: ['game_failure'] };
    if (api.startsWith('api_start2')) this.fatigue.reset();
    const master = b.api_data?.api_mst_ship;
    if (Array.isArray(master)) for (const s of master) {
      if (integer(s.api_id) && typeof s.api_name === 'string') this.names.set(s.api_id, s.api_name.slice(0, 80));
    }
    const missions = b.api_data?.api_mst_mission;
    if (Array.isArray(missions)) for (const m of missions) {
      if (integer(m.api_id) && typeof m.api_name === 'string') this.missions.set(m.api_id, m.api_name.slice(0, 80));
    }
    const ships = api === 'api_port/port' ? b.api_data?.api_ship
      : api === 'api_get_member/ship2' ? b.api_data : b.api_data?.api_ship_data;
    if (Array.isArray(ships)) for (const s of ships) {
      if (integer(s.api_id) && integer(s.api_ship_id)) this.ships.set(s.api_id, s.api_ship_id);
    }
    const events = [], errors = [];
    const addRows = (kind, rows) => {
      if (!Array.isArray(rows)) { errors.push(`${kind}_missing`); return; }
      for (const r of rows) {
        if (kind === 'expedition' && r?.api_id === 1) continue;
        if (!r || !slot(r.api_id, kind)) { errors.push(`${kind}_slot`); continue; }
        let state, end, subject;
        if (kind === 'expedition') {
          if (!Array.isArray(r.api_mission) || r.api_mission.length < 3 || ![0, 1, 2, 3].includes(r.api_mission[0])) {
            errors.push('expedition_state'); continue;
          }
          state = r.api_mission[0] > 0 ? 'active' : 'empty';
          end = r.api_mission[2]; subject = r.api_mission[1];
        } else {
          const known = kind === 'repair' ? [-1, 0, 1] : [-1, 0, 2, 3];
          if (!known.includes(r.api_state)) { errors.push(`${kind}_state`); continue; }
          state = r.api_state <= 0 ? 'empty' : kind === 'build' && r.api_state === 3 ? 'complete' : 'active';
          end = r.api_complete_time; subject = kind === 'repair' ? r.api_ship_id : null;
        }
        if (state === 'active' && (!time(end) || (kind !== 'build' && (!integer(subject) || subject <= 0)))) {
          errors.push(`${kind}_active_data`); continue;
        }
        const event = { kind, slot: r.api_id, action: 'snapshot', state, end: state === 'active' ? end : null,
          subject: kind === 'build' || state !== 'active' ? null : subject };
        if (kind === 'expedition' && state === 'active' && integer(subject)) {
          event.name = this.missions.get(subject) || '';
        }
        if (kind === 'repair') event.name = this.names.get(this.ships.get(subject)) || '';
        if (kind === 'build' && !this.hideBuildName && integer(r.api_created_ship_id)) {
          event.name = this.names.get(r.api_created_ship_id) || '';
        }
        events.push(event);
      }
    };
    if (fleetApis.has(api)) addRows('expedition', fleetApis.get(api)(b));
    if (repairApis.has(api)) addRows('repair', repairApis.get(api)(b));
    if (buildApis.has(api)) addRows('build', buildApis.get(api)(b));
    if (Object.hasOwn(operations, api)) {
      const [kind, field, action] = operations[api];
      if (!slot(params[field], kind)) errors.push('operation_slot');
      else {
        let event = { kind, slot: params[field], action, state: action === 'complete' ? 'complete' : 'pending', end: null, subject: null };
        if (action === 'start') {
          if (kind !== 'expedition' && ![0, 1].includes(params.api_highspeed)) errors.push('operation_highspeed');
          else {
            if (params.api_highspeed === 1) { event.action = 'complete'; event.state = 'complete'; }
            if (kind === 'repair') event.subject = params.api_ship_id;
            if (kind === 'expedition') {
              event.subject = params.api_mission_id;
              if (integer(event.subject)) event.name = this.missions.get(event.subject) || '';
            }
            if (kind !== 'build' && (!integer(event.subject) || event.subject <= 0)) errors.push('operation_subject');
            else events.push(event);
          }
        } else if (action === 'change') {
          const m = b.api_data?.api_mission;
          if (!Array.isArray(m) || !time(m[2]) || !integer(m[1]) || m[1] <= 0) errors.push('return_data');
          else events.push({ ...event, state: 'active', end: m[2], subject: m[1], name: this.missions.get(m[1]) || '' });
        } else events.push(event);
      }
    }
    const fatigue = this.fatigue.apply(api, b, params, observedAt);
    return { events, errors: [...new Set(errors)], fatigue, akashi: this.akashi.apply(api, b, params, observedAt, fatigue) };
  }
}
