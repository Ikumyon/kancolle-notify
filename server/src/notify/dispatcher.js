import { Repository } from '../repository/repository.js';
import { reconcile, record } from '../domain/state.js';
import { retryDelay } from '../domain/timer.js';
import { DiscordProvider } from './providers/discord.js';
import { TelegramProvider } from './providers/telegram.js';
import { publicTimer } from '../domain/timer.js';
export class NotificationDispatcher {
  constructor(providers = [new DiscordProvider(), new TelegramProvider()]) { this.providers = providers; }
  async dispatch(env, { now = () => Date.now(), send = fetch } = {}) {
    const repo = new Repository(env.DB), token = crypto.randomUUID();
    const safeSend = typeof send === 'function' ? (...args) => send.call(globalThis, ...args) : fetch;
    const claimed = await repo.mutate(s => {
      reconcile(s, now());
      const ready = [];
      // 各プロバイダから一件ずつ。次の予約はAlarmで処理する。
      for (const provider of this.providers) {
        if (!s.settings.providers[provider.name]) continue;
        const d = Object.values(s.deliveries).filter(d => d.provider === provider.name && ['pending', 'sending'].includes(d.status) &&
          Math.max(d.dueAt, d.nextTryAt, d.leaseUntil) <= now()).sort((a, b) => a.dueAt - b.dueAt)[0];
        if (!d) continue;
        d.status = 'sending'; d.token = token; d.leaseUntil = now() + 60000; d.attempts++;
        ready.push({ ...structuredClone(d), item: publicTimer(d.item, s.settings, now()) });
      }
      return ready;
    });
    const results = await Promise.all(claimed.map(async d => {
      const provider = this.providers.find(p => p.name === d.provider);
      let result;
      try {
        result = provider.isConfigured(env) ? await provider.send({ ...d, sentAt: now() }, env, safeSend)
          : { ok: false, permanent: true, code: 'not_configured' };
      } catch (e) {
        console.error(`[dispatcher] error sending via ${d.provider}:`, e);
        result = { ok: false, uncertain: true, code: 'transport' };
      }
      await repo.mutate(s => {
        const current = s.deliveries[d.id];
        if (!current || current.token !== token) return;
        current.leaseUntil = 0;
        current.status = result.ok ? 'sent' : result.permanent ? 'failed' : 'pending';
        current.code = result.code || null; current.uncertain = !!result.uncertain;
        if (result.ok) { current.sentAt = now(); current.messageId = result.messageId ?? null; }
        else current.nextTryAt = now() + Math.max(retryDelay(current.attempts), result.retryAfter || 0);
        const timer = s.timers[d.timerId];
        if (timer?.kind === 'manual' && timer.state === 'active') {
          const enabled = Object.entries(s.settings.providers).filter(([, value]) => value).map(([name]) => name);
          if (enabled.length && enabled.every(provider => Object.values(s.deliveries).some(job => job.timerId === timer.id && job.provider === provider && job.phase === 'complete' && job.status === 'sent'))) {
            timer.state = 'complete'; timer.notifyAt = null;
          }
        }
        record(s, now(), result.ok ? 'delivery_sent' : 'delivery_failed', { id: d.id, provider: d.provider, code: current.code });
        reconcile(s, now());
      });
      return { id: d.id, provider: d.provider, ...result };
    }));
    await repo.prune(now());
    return results;
  }
}
const dispatcher = new NotificationDispatcher();
export const dispatch = (env, options) => dispatcher.dispatch(env, options);
