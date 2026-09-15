import { getOffsetSec } from '../../domain/timer.js';
import { nextDeliveryAt } from '../../domain/state.js';

export const json = (data, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function snapshot(repo, now = Date.now()) {
  const { state } = await repo.read();
  const offsetSec = getOffsetSec(state);
  return {
    now,
    slots: state.slots,
    history: await repo.history(now),
    pendingDelivery: state.delivery ? { attempt: state.delivery.attempt, nextTry: state.delivery.nextTry } : null,
    authBlocked: state.authBlocked,
    offsetSec,
    notificationAdvanceSec: offsetSec < 0 ? -offsetSec : 0, // 後方互換性維持
    nextNotificationAt: nextDeliveryAt(state, now)
  };
}

export async function handleStatus(request, env, repo) {
  return json(await snapshot(repo));
}
