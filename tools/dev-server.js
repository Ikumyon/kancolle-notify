import { akashiFixture } from './akashi-fixture.js';
import http from 'node:http';
import { mkdirSync, existsSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { LocalD1 } from './sqlite.js';
import worker, { dispatch } from '../server/worker.js';
const directory = new URL('../.local/', import.meta.url); mkdirSync(directory, { recursive: true });
const credentialsFile = new URL('devices.json', directory);
if (!existsSync(credentialsFile)) writeFileSync(credentialsFile, JSON.stringify({ windows: randomBytes(32).toString('base64url'), mint: randomBytes(32).toString('base64url') }, null, 2));
export const TEST_MODE_TOKEN = 'test-mode-fixed-token-for-dev-server-only-12345';
const tokens = { ...JSON.parse(readFileSync(credentialsFile, 'utf8')), test_mode: TEST_MODE_TOKEN };
const env = { DB: new LocalD1(new URL('state.sqlite', directory).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  DEVICE_TOKENS: JSON.stringify(Object.fromEntries(Object.entries(tokens).map(([id, token]) => [id, createHash('sha256').update(token).digest('hex')]))),
  TELEGRAM_BOT_TOKEN: 'mock', TELEGRAM_CHAT_ID: 'mock' };
let requests = 0, serial = Promise.resolve();
const instance = randomBytes(8).toString('hex'), requestLog = [];
const mockSend = async (_url, options) => {
  appendFileSync(new URL('notifications.jsonl', directory), JSON.stringify({ at: Date.now(), text: JSON.parse(options.body).text }) + '\n');
  console.log('模擬通知を .local/notifications.jsonl に記録しました');
  return Response.json({ ok: true, result: { message_id: Date.now() } });
};
const tick = () => { serial = serial.then(() => dispatch(env, { send: mockSend })).catch(() => console.error('模擬配信処理でエラー')); };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:8787');
    if (url.pathname === '/mock') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(readFileSync(new URL('mock.html', import.meta.url))); return;
    }
    if (url.pathname === '/mock.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(readFileSync(new URL('mock.js', import.meta.url))); return; }
    if (url.pathname === '/mock/count') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ instance, requests, recent: requestLog })); return; }
    if (url.pathname.includes('/kcsapi/')) {
      requests++;
      const entry = { number: requests, at: Date.now(), method: req.method, path: url.pathname };
      requestLog.push(entry); if (requestLog.length > 100) requestLog.shift();
      console.log(`[疑似ゲームAPI #${requests}] ${req.method} ${url.pathname}`);
    }
    const sendGameApi = (data) => {
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Date': new Date(Date.now() - (url.searchParams.has('akashi') ? 1200000 : 0)).toUTCString()
      });
      res.end('svdata=' + JSON.stringify({ api_result: 1, api_data: data }));
    };

    if (url.searchParams.has('akashi') && url.pathname.startsWith('/kcsapi/')) {
      const fixture = akashiFixture(url.pathname.slice(8));
      if (fixture !== null) return sendGameApi(fixture);
    }

    if (url.pathname === '/kcsapi/api_start2/getData' || url.pathname === '/kcsapi/api_start2') {
      return sendGameApi({
        api_mst_ship: [
          { api_id: 1, api_name: '吹雪', api_fuel_max: 15, api_bull_max: 20 },
          { api_id: 2, api_name: '白雪', api_fuel_max: 15, api_bull_max: 20 },
          { api_id: 3, api_name: '初雪', api_fuel_max: 15, api_bull_max: 20 },
          { api_id: 4, api_name: '深雪', api_fuel_max: 15, api_bull_max: 20 },
          { api_id: 5, api_name: '叢雲', api_fuel_max: 15, api_bull_max: 20 },
          { api_id: 131, api_name: '大和', api_fuel_max: 100, api_bull_max: 130 }
        ]
      });
    }

    if (url.pathname === '/kcsapi/api_port/port') {
      const now = Date.now();
      return sendGameApi({
        api_ship: [
          { api_id: 1, api_ship_id: 1, api_cond: 49, api_fuel: 15, api_bull: 20, api_nowhp: 30, api_maxhp: 30 },
          { api_id: 2, api_ship_id: 2, api_cond: 50, api_fuel: 15, api_bull: 20, api_nowhp: 30, api_maxhp: 30 },
          { api_id: 3, api_ship_id: 3, api_cond: 33, api_fuel: 15, api_bull: 20, api_nowhp: 30, api_maxhp: 30 },
          { api_id: 4, api_ship_id: 4, api_cond: 54, api_fuel: 15, api_bull: 20, api_nowhp: 30, api_maxhp: 30 },
          { api_id: 5, api_ship_id: 5, api_cond: 25, api_fuel: 15, api_bull: 20, api_nowhp: 30, api_maxhp: 30 },
          { api_id: 6, api_ship_id: 131, api_cond: 40, api_fuel: 100, api_bull: 130, api_nowhp: 50, api_maxhp: 96 }
        ],
        api_deck_port: [
          { api_id: 1, api_ship: [1, 2], api_mission: [0, 0, 0] },
          { api_id: 2, api_ship: [3], api_mission: [1, 5, now + 1500000] }, // 海上護衛任務 (25分後)
          { api_id: 3, api_ship: [4], api_mission: [1, 38, now + 3600000] }, // 東京急行 (60分後)
          { api_id: 4, api_ship: [5], api_mission: [0, 0, 0] }
        ],
        api_ndock: [
          { api_id: 1, api_state: 1, api_ship_id: 6, api_complete_time: now + 7200000 }, // 大和 (2時間後)
          { api_id: 2, api_state: 0, api_ship_id: 0, api_complete_time: 0 },
          { api_id: 3, api_state: 0, api_ship_id: 0, api_complete_time: 0 },
          { api_id: 4, api_state: 0, api_ship_id: 0, api_complete_time: 0 }
        ],
        api_material: [{ api_id: 1, api_value: 50000 }]
      });
    }

    if (url.pathname === '/kcsapi/api_get_member/kdock') {
      const now = Date.now();
      return sendGameApi([
        { api_id: 1, api_state: 2, api_complete_time: now + 1800000 }, // 建造中 (30分後)
        { api_id: 2, api_state: 0, api_complete_time: 0 },
        { api_id: 3, api_state: 0, api_complete_time: 0 },
        { api_id: 4, api_state: 0, api_complete_time: 0 }
      ]);
    }

    if (url.pathname === '/kcsapi/api_get_member/ndock') {
      const now = Date.now();
      return sendGameApi([
        { api_id: 1, api_state: 1, api_ship_id: 6, api_complete_time: now + 7200000 },
        { api_id: 2, api_state: 0, api_ship_id: 0, api_complete_time: 0 },
        { api_id: 3, api_state: 0, api_ship_id: 0, api_complete_time: 0 },
        { api_id: 4, api_state: 0, api_ship_id: 0, api_complete_time: 0 }
      ]);
    }

    if (url.pathname === '/kcsapi/api_get_member/deck') {
      const now = Date.now();
      return sendGameApi([
        { api_id: 1, api_ship: [1, 2], api_mission: [0, 0, 0] },
        { api_id: 2, api_ship: [3], api_mission: [1, 5, now + 1500000] },
        { api_id: 3, api_ship: [4], api_mission: [1, 38, now + 3600000] },
        { api_id: 4, api_ship: [5], api_mission: [0, 0, 0] }
      ]);
    }

    const parts = []; let size = 0;
    for await (const p of req) { size += p.length; if (size > 131072) { res.writeHead(413); res.end(); return; } parts.push(p); }
    const input = new Request(url, { method: req.method, headers: req.headers,
      ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(parts) }) });
    const response = await worker.fetch(input, env);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end('local_error'); }
});
server.listen(8787, '127.0.0.1', () => console.log('模擬環境 http://127.0.0.1:8787/mock\n接続トークン: .local/devices.json（ローカル専用）\n外部への通知送信は行いません。'));
const timer = setInterval(tick, 60000);
process.on('SIGINT', () => { clearInterval(timer); server.close(() => { env.DB.close(); process.exit(0); }); });
