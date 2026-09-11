import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LocalD1 } from '../tools/sqlite.js';
import worker, { dispatch } from '../server/worker.js';
import { Repository } from '../server/repository.js';
const token='A'.repeat(40);
const make=()=>({DB:new LocalD1(),DEVICE_TOKENS:JSON.stringify({win:createHash('sha256').update(token).digest('hex')}),TELEGRAM_BOT_TOKEN:'mock',TELEGRAM_CHAT_ID:'mock'});
const req=(path,body,auth=token)=>new Request('https://notify.example.workers.dev'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${auth}`},...(body?{body:JSON.stringify(body)}:{})});
async function seed(env) {
  const {ticket}=await (await worker.fetch(req('/v2/session',{session:'play'}),env)).json();
  const o={...ticket,seq:1,events:[{kind:'expedition',slot:2,action:'snapshot',state:'active',end:Date.now()-1,subject:5}],errors:[]};
  const response=await worker.fetch(req('/v2/observations',{observations:[o]}),env);
  assert.equal(response.status,200); return {o,reply:await response.json()};
}
test('new API rejects legacy payload and includes display state in synchronization response',async()=>{
  const env=make();try {
    assert.equal((await worker.fetch(req('/v2/status',null,'bad'),env)).status,401);
    assert.equal((await worker.fetch(req('/v1/time'),env)).status,404);
    const {o,reply}=await seed(env);assert.ok(reply.state.slots['expedition:2']);
    assert.equal((await worker.fetch(req('/v2/observations',{observations:[{...o,time:null}]}),env)).status,400);
    assert.ok(!JSON.stringify(reply).includes(token));
  }finally{env.DB.close();}
});
test('overlapping dispatches share a lease and notify once without extension requests',async()=>{
  const env=make();try {
    await seed(env);let sends=0;
    const send=async()=>{sends++;return Response.json({ok:true,result:{message_id:1}});};
    await Promise.all([dispatch(env,{send}),dispatch(env,{send})]);
    await dispatch(env,{send});assert.equal(sends,1);
    assert.ok((await new Repository(env.DB).history()).some(e=>e.type==='sent'));
  }finally{env.DB.close();}
});
test('Telegram auth error blocks and explicit resume permits retry',async()=>{
  const env=make();try {
    await seed(env);
    await dispatch(env,{send:async()=>Response.json({ok:false,error_code:401},{status:401})});
    assert.equal((await new Repository(env.DB).read()).state.authBlocked,true);
    const r=await (await worker.fetch(req('/v2/resume',{}),env)).json();assert.equal(r.state.authBlocked,false);
  }finally{env.DB.close();}
});
test('explicit reset creates a new UUID and removes all old reservations',async()=>{
  const env=make();try {
    await seed(env);const repo=new Repository(env.DB), old=(await repo.read()).state.epoch;
    env.DB.sqlite.exec(readFileSync(new URL('../server/reset-reservations.sql',import.meta.url),'utf8'));
    const fresh=(await repo.read()).state;
    assert.notEqual(fresh.epoch,old);assert.deepEqual(fresh.slots,{});assert.equal(fresh.generation,'0');
  }finally{env.DB.close();}
});
