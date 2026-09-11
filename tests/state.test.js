import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, observe, claimDelivery, finishDelivery, prune } from '../extension/core/state.js';
import { beginSession, MAX_GENERATION } from '../extension/core/generation.js';
const now = 1800000000000;
const event = (end = now + 60000) => ({kind:'expedition',slot:2,action:'snapshot',state:'active',end,subject:5});
const observation = (ticket, seq, e = event()) => ({...ticket,seq,events:[e],errors:[]});
test('switching PC rejects old outbox and retrying old session never takes ownership', () => {
  const s=emptyState(), old=beginSession(s,'old','windows',now);
  observe(s,observation(old,1),'windows',now);
  const current=beginSession(s,'new','mint',now);
  observe(s,observation(current,1,event(now+120000)),'mint',now);
  assert.deepEqual(beginSession(s,'old','windows',now),old);
  assert.equal(observe(s,observation(old,2),'windows',now).status,'stale_session');
  assert.equal(s.slots['expedition:2'].end,now+120000);
  assert.equal(observe(s,observation(current,1),'mint',now).status,'duplicate');
  prune(s,now+40*86400000);
  assert.equal(observe(s,observation(old,3),'windows',now).status,'stale_session');
});
test('rollover changes UUID and returns to one without number precision loss', () => {
  const s=emptyState(); s.generation=(MAX_GENERATION-1n).toString();
  const last=beginSession(s,'last','windows',now);
  assert.equal(last.generation,'9223372036854775807');
  const first=beginSession(s,'first','windows',now);
  assert.equal(first.generation,'1'); assert.notEqual(first.epoch,last.epoch);
  assert.equal(observe(s,observation(last,1),'windows',now).status,'stale_session');
  assert.equal(observe(emptyState(),observation(first,1),'windows',now).status,'stale_session');
});
test('Unix deadline is unchanged and identical snapshots across sessions do not repeat notification', () => {
  const s=emptyState(), ticket=beginSession(s,'one','windows',now);
  observe(s,observation(ticket,1),'windows',now);
  assert.equal(s.slots['expedition:2'].end,event().end);
  assert.equal(claimDelivery(s,now+59999,'early'),null);
  assert.equal(claimDelivery(s,now+60000,'due').items.length,1);
  finishDelivery(s,'due',now+60000,{ok:true});
  const next=beginSession(s,'two','mint',now+70000);
  observe(s,observation(next,1),'mint',now+70000);
  assert.equal(claimDelivery(s,now+70000,'again'),null);
});
test('newer cancellation wins and old sequence cannot restore deadline', () => {
  const s=emptyState(), ticket=beginSession(s,'one','windows',now);
  observe(s,observation(ticket,1),'windows',now);
  observe(s,observation(ticket,3,{...event(null),action:'complete',state:'complete',subject:null}),'windows',now+1);
  assert.equal(observe(s,observation(ticket,2),'windows',now+2).status,'duplicate');
  assert.equal(claimDelivery(s,now+90000,'due'),null);
});
