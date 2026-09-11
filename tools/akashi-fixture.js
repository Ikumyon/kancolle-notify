// Local mock only. These values are never fetched from the game.
export function akashiFixture(api) {
  if (api.startsWith('api_start2')) return { api_mst_ship: [
    { api_id: 187, api_name: '明石改', api_stype: 19, api_ctype: 49 },
    { api_id: 1, api_name: '吹雪改二', api_stype: 2, api_ctype: 1 }
  ], api_mst_slotitem: [{ api_id: 86, api_type: [0, 0, 31] }] };
  if (api === 'api_get_member/slot_item') return [{ api_id: 100, api_slotitem_id: 86 }];
  if (api === 'api_port/port') return {
    api_ship: [
      { api_id: 1, api_ship_id: 187, api_nowhp: 35, api_maxhp: 37, api_ndock_time: 1230000, api_cond: 49, api_slot: [100] },
      { api_id: 2, api_ship_id: 1, api_nowhp: 28, api_maxhp: 36, api_ndock_time: 2730000, api_cond: 49, api_slot: [] }
    ], api_deck_port: [1, 2, 3, 4].map(id => ({ api_id: id, api_ship: id === 1 ? [1] : [], api_mission: [0, 0, 0] })), api_ndock: []
  };
  if (api === 'api_req_hensei/change') return {};
  return null;
}
