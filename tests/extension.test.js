import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { moduleIn, settle, storage } from './harness.js';
import { LocalD1 } from '../tools/sqlite.js';
import worker from '../server/worker.js';
import { dispatch } from '../server/worker.js';
import { createHash } from 'node:crypto';
import { Parser } from '../extension/core/parser.js';
import { akashiFixture } from '../tools/akashi-fixture.js';

test('akashi passive observations reach the central service; PC-free individual completion is simulated', async () => {
  const local = storage(), paths = [], parser = new Parser(); let handler;
  const token = 'C'.repeat(40), origin = 'https://akashi.example.workers.dev', at = Date.now();
  const env = { DB: new LocalD1(), DEVICE_TOKENS: JSON.stringify({ pc: createHash('sha256').update(token).digest('hex') }), TELEGRAM_BOT_TOKEN: 'mock', TELEGRAM_CHAT_ID: 'mock' };
  local.data.config = { url: origin, token };
  const invoke = m => new Promise(resolve => handler(m, { id: 'extension', url: 'chrome-extension://extension/devtools.html' }, resolve));
  try {
    await moduleIn('../extension/background.js', { chrome: { storage: { local: local.api }, runtime: {
      id: 'extension', getURL: p => 'chrome-extension://extension/' + p, onMessage: { addListener: fn => { handler = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }
    }, alarms: { clear: async () => {}, get: async () => null, create: async () => {}, onAlarm: { addListener() {} } } },
      fetch: async (url, init) => { assert.ok(url.startsWith(origin + '/v2/')); paths.push(url); return worker.fetch(new Request(url, init), env); } });
    await invoke({ type: 'begin', session: 'akashi-play' });
    let seq = 0;
    const enqueue = async (api, params = {}) => {
      const result = parser.parse(api, { api_result: 1, api_data: akashiFixture(api) }, params, 200, at);
      const reply = await invoke({ type: 'enqueue', observation: { session: 'akashi-play', seq: ++seq, events: result.events, errors: result.errors }, fatigue: result.fatigue, akashi: result.akashi });
      assert.equal(reply.error, undefined);
    };
    for (const api of ['api_start2/getData', 'api_get_member/slot_item', 'api_port/port']) await enqueue(api);
    await enqueue('api_req_hensei/change', { api_id: 1, api_ship_idx: 1, api_ship_id: 2 });
    assert.equal(local.data.remoteCache.slots['akashi:1'].repair.ships.length, 2);
    const count = paths.length;
    await enqueue('api_get_member/slot_item');
    assert.equal(paths.length, count);
    const texts = [];
    const send = async (_url, init) => { texts.push(JSON.parse(init.body).text); return Response.json({ ok: true, result: { message_id: texts.length } }); };
    await dispatch(env, { now: () => at + 1200000, send });
    assert.equal(texts.length, 1); assert.match(texts[0], /全回復/); assert.match(texts[0], /あと25分/);
    await dispatch(env, { now: () => at + 1800000, send });
    assert.equal(texts.length, 1);
    await dispatch(env, { now: () => at + 2700000, send });
    assert.equal(texts.length, 2); assert.match(texts[1], /吹雪改二: 28->36 \+8　全回復/);
    assert.equal(paths.length, count);
  } finally { env.DB.close(); }
});

test('fatigue target changes use ordered observations, unchanged inputs stay local, and delivery is simulated', async () => {
  const local = storage(), paths = []; let handler;
  const token = 'B'.repeat(40), origin = 'https://fatigue.example.workers.dev', now = Date.now();
  const env = { DB: new LocalD1(), DEVICE_TOKENS: JSON.stringify({ pc: createHash('sha256').update(token).digest('hex') }), TELEGRAM_BOT_TOKEN: 'mock', TELEGRAM_CHAT_ID: 'mock' };
  local.data.config = { url: origin, token };
  const invoke = m => new Promise(resolve => handler(m, { id: 'extension', url: 'chrome-extension://extension/popup.html' }, resolve));
  const snapshot = { at: now, needsPort: false, docksKnown: true, docks: [], fleets: { 1: { ships: [1], away: false } }, ships: { 1: { cond: 30, at: now } } };
  try {
    await moduleIn('../extension/background.js', { chrome: { storage: { local: local.api }, runtime: {
      id: 'extension', getURL: p => 'chrome-extension://extension/' + p, onMessage: { addListener: fn => { handler = fn; } },
      onInstalled: { addListener() {} }, onStartup: { addListener() {} }
    }, alarms: { clear: async () => {}, get: async () => null, create: async () => {}, onAlarm: { addListener() {} } } },
      fetch: async (url, init) => { assert.ok(url.startsWith(origin + '/v2/')); paths.push(url); return worker.fetch(new Request(url, init), env); } });
    await invoke({ type: 'fatigue-settings', settings: { presets: [36, 45], defaultTarget: 36, fleets: {} } });
    await invoke({ type: 'begin', session: 'fatigue-play' });
    await invoke({ type: 'enqueue', observation: { session: 'fatigue-play', seq: 1, events: [], errors: [] }, fatigue: snapshot });
    assert.equal(local.data.remoteCache.slots['fatigue:1'].end, now + 360000);
    const count = paths.length;
    await invoke({ type: 'enqueue', observation: { session: 'fatigue-play', seq: 2, events: [], errors: [] }, fatigue: { ...snapshot, at: now + 1000 } });
    assert.equal(paths.length, count);
    await invoke({ type: 'fatigue-target', fleet: 1, target: 45 });
    const end = local.data.remoteCache.slots['fatigue:1'].end;
    assert.equal(end, now + 900000); assert.equal(paths.length, count + 1);
    await invoke({ type: 'enqueue', observation: { session: 'fatigue-play', seq: 3, events: [], errors: [] }, fatigue: snapshot });
    assert.equal(paths.length, count + 1);
    const texts = [];
    await dispatch(env, { now: () => end, send: async (_url, init) => {
      texts.push(JSON.parse(init.body).text); return Response.json({ ok: true, result: { message_id: 1 } });
    } });
    assert.equal(texts.length, 1); assert.match(texts[0], /目標 45/);
  } finally { env.DB.close(); }
});

test('real collector only reads cached game bodies; repeated reads and failures add zero game requests', async () => {
  let gameRequests = 0, listener, reads = 0;
  const received = [], local = storage();
  const server = http.createServer((_req, res) => { gameRequests++; res.end('svdata=' + JSON.stringify({ api_result: 1, api_data: [{ api_id: 2, api_mission: [1, 5, Date.now() + 60000] }] })); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/kcsapi/api_get_member/deck`;
    const chrome = { storage: { local: local.api }, runtime: { sendMessage: async m => {
      assert.notEqual(m.type, 'clock');
      if (m.type === 'enqueue') received.push(m.observation);
      return { value: { stored: true } };
    } }, devtools: { network: { onRequestFinished: { addListener: fn => { listener = fn; } } },
      inspectedWindow: { tabId: 1 }, panels: { create: () => {} } } };
    await moduleIn('../extension/devtools.js', { chrome, performance, Date, setInterval: () => {},
      window: { addEventListener: () => {} }, atob,
      fetch: () => { throw new Error('collector_must_not_fetch'); } });
    await settle();
    const body = await (await fetch(url, { method: 'POST' })).text();
    const request = { request: { url }, response: { status: 200 }, time: 1,
      getContent: cb => { reads++; cb(body, ''); } };
    listener(request); listener(request);
    listener({ ...request, getContent: cb => { reads++; cb(undefined); } });
    listener({ ...request, response: { status: 500 } });
    await settle(); await settle();
    assert.equal(gameRequests, 1); assert.equal(reads, 4); assert.equal(received.length, 4);
    assert.equal(received[0].events[0].end, received[1].events[0].end);
    assert.equal('time' in received[0], false); assert.equal(received[2].events.length, 0);
    assert.equal(received[3].events.length, 0);
    assert.deepEqual(received.map(r => r.seq), [1, 2, 3, 4]);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});

test('unchanged observations cause zero requests, retry survives restart, retired session cannot reclaim', async () => {
  const local=storage(), alarms=new Map(), paths=[];let handler, alarmHandler, loseReply=false;
  const token='A'.repeat(40), origin='https://test.example.workers.dev';
  const env={DB:new LocalD1(),DEVICE_TOKENS:JSON.stringify({win:createHash('sha256').update(token).digest('hex')})};
  local.data.config={url:origin,token};
  const globals={chrome:{storage:{local:local.api}, runtime:{id:'extension',getURL:p=>'chrome-extension://extension/'+p,
    onMessage:{addListener:fn=>{handler=fn;}},onInstalled:{addListener:()=>{}},onStartup:{addListener:()=>{}}},
    alarms:{get:async n=>alarms.get(n),clear:async n=>alarms.delete(n),create:async(n,v)=>alarms.set(n,v),onAlarm:{addListener:fn=>{alarmHandler=fn;}}}},
    fetch:async(url,init)=>{
      assert.ok(url.startsWith(origin+'/v2/'));assert.equal(init.redirect,'error');paths.push(new URL(url).pathname);
      const r=await worker.fetch(new Request(url,init),env);
      if(loseReply&&url.endsWith('/observations')){loseReply=false;throw new Error('lost response');}return r;
    }};
  const invoke=m=>new Promise(resolve=>handler(m,{id:'extension',url:'chrome-extension://extension/devtools.html'},resolve));
  const e={kind:'repair',slot:1,action:'snapshot',state:'active',end:Date.now()+60000,subject:100,name:'睦月'};
  const enqueue=(seq,event=e)=>invoke({type:'enqueue',observation:{session:'one',seq,events:[event],errors:[]}});
  try {
    await moduleIn('../extension/background.js',globals);
    await invoke({type:'begin',session:'one'});await enqueue(1);
    assert.deepEqual(paths,['/v2/session','/v2/observations']);
    for(let seq=2;seq<12;seq++)await enqueue(seq);
    await invoke({type:'local'});await alarmHandler({name:'maintenance'});
    assert.equal(paths.length,2);assert.equal(alarms.size,0);
    loseReply=true;await enqueue(12,{...e,end:e.end+60000});assert.equal(local.data.queue.length,1);
    await moduleIn('../extension/background.js',globals);await invoke({type:'retry'});
    assert.equal(local.data.queue.length,0);assert.equal(local.data.remoteCache.slots['repair:1'].end,e.end+60000);
    await worker.fetch(new Request(origin+'/v2/session',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({session:'two'})}),env);
    await enqueue(13,{...e,end:e.end+120000});assert.equal(local.data.play.retired,true);
    const count=paths.length;await invoke({type:'retry'});await enqueue(14);
    assert.equal(paths.length,count);assert.equal(paths.filter(p=>p==='/v2/session').length,1);
    assert.equal(paths.filter(p=>p==='/v2/status').length,0);
  } finally {env.DB.close();}
});

