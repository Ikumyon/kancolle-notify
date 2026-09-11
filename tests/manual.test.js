import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, manualReservation, claimDelivery, finishDelivery, formatDelivery } from '../extension/core/state.js';
import { jstTimestamp } from '../extension/core/manual.js';
import { LocalD1 } from '../tools/sqlite.js';
import worker from '../server/worker.js';
import { createHash } from 'node:crypto';
test('manual minutes use server time; retry keeps deadline; cancellation prevents dispatch', () => {
  const s = emptyState(), now = 1800000000000;
  const command = { id: 'manual-test-123456', action: 'create', title: '確認', mode: 'minutes', minutes: 5 };
  const first = manualReservation(s, command, 'windows', now);
  assert.equal(first.reservation.end, now + 300000);
  assert.equal(manualReservation(s, command, 'windows', now + 120000).reservation.end, first.reservation.end);
  assert.equal(claimDelivery(s, now + 299999, 'early'), null);
  const due = claimDelivery(s, now + 300000, 'due'); assert.match(formatDelivery(due), /手動予約 確認/);
  finishDelivery(s, 'due', now + 300001, { ok: true });
  assert.equal(claimDelivery(s, now + 360000, 'repeat'), null);
  const second = { ...command, id: 'manual-cancel-12345' };
  manualReservation(s, second, 'windows', now);
  manualReservation(s, { id: second.id, action: 'cancel' }, 'mint', now + 1000);
  assert.equal(manualReservation(s, second, 'windows', now + 2000).reservation.state, 'complete');
  assert.equal(claimDelivery(s, now + 400000, 'cancelled'), null);
});
test('explicit dates are JST independent of PC zone, with invalid dates rejected', () => {
  assert.equal(jstTimestamp('2026-09-10T12:30'), Date.parse('2026-09-10T03:30:00Z'));
  assert.throws(() => jstTimestamp('2026-02-30T12:30'));
  assert.throws(() => manualReservation(emptyState(), { id: 'manual-test-123456', action: 'create', title: 'x', mode: 'minutes', minutes: 0 }, 'win', 1800000000000));
});
test('authenticated manual API persists and cancels separately from game slots', async () => {
  const token = 'B'.repeat(40), db = new LocalD1();
  const env = { DB: db, DEVICE_TOKENS: JSON.stringify({ win: createHash('sha256').update(token).digest('hex') }) };
  const send = command => worker.fetch(new Request('https://test.example.workers.dev/v2/manual', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(command)
  }), env);
  try {
    const c = { id: 'api-manual-12345678', action: 'create', title: '疑似通知', mode: 'minutes', minutes: 1 };
    const result = await (await send(c)).json();
    assert.equal(result.status, 'applied'); assert.equal(result.reservation.end, result.now + 60000);
    assert.equal((await (await send(c)).json()).reservation.end, result.reservation.end);
    assert.equal((await (await send({ id: c.id, action: 'cancel' })).json()).reservation.state, 'complete');
  } finally { db.close(); }
});

test('build notification format includes name when present and hides it when omitted', () => {
  const deliveryWithName = {
    items: [{ kind: 'build', slot: 1, type: 'normal', end: 1800000000000, name: '大和' }]
  };
  const textWithName = formatDelivery(deliveryWithName);
  assert.match(textWithName, /建造 第1ドック 大和/);
  assert.match(textWithName, /終了予定時刻になりました/);

  const deliveryWithoutName = {
    items: [{ kind: 'build', slot: 1, type: 'normal', end: 1800000000000 }]
  };
  const textWithoutName = formatDelivery(deliveryWithoutName);
  assert.match(textWithoutName, /^建造 第1ドック\n/);
  assert.doesNotMatch(textWithoutName, /大和/);
});

