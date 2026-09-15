import { json, snapshot } from './status.js';
import { getOffsetSec } from '../../domain/timer.js';

export async function handleGetSettings(request, env, repo) {
  const { state } = await repo.read();
  const offsetSec = getOffsetSec(state);
  return json({
    offsetSec,
    advanceSec: offsetSec < 0 ? -offsetSec : 0 // 後方互換性
  });
}

export async function handlePostSettings(request, env, repo) {
  const text = await request.text();
  if (text.length > 512) return json({ error: 'invalid_settings' }, 400);

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'invalid_settings' }, 400);
  }

  // offsetSec (-3600 ~ +3600) または旧 advanceSec (0 ~ 3600) のサポート
  let targetOffset = null;
  if (Number.isInteger(body?.offsetSec) && body.offsetSec >= -3600 && body.offsetSec <= 3600) {
    targetOffset = body.offsetSec;
  } else if (Number.isInteger(body?.advanceSec) && body.advanceSec >= 0 && body.advanceSec <= 3600) {
    targetOffset = -body.advanceSec;
  }

  if (targetOffset === null) return json({ error: 'invalid_settings' }, 400);

  await repo.mutate(s => {
    s.offsetSec = targetOffset;
    s.notificationAdvanceSec = targetOffset < 0 ? -targetOffset : 0;
    // 送信された可能性のある配信は維持し、未送信の再試行分のみ新設定で再計算する。
    if (s.delivery && !s.delivery.uncertain && s.delivery.leaseUntil <= Date.now()) {
      s.delivery = null;
    }
  });

  return json({
    ok: true,
    offsetSec: targetOffset,
    advanceSec: targetOffset < 0 ? -targetOffset : 0
  });
}

export async function handleResume(request, env, repo) {
  await repo.mutate(s => {
    s.authBlocked = false;
  });
  return json({ ok: true, state: await snapshot(repo) });
}
