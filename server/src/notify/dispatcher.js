import { Repository } from '../repository/repository.js';
import { prune, claimDelivery, finishDelivery } from '../domain/state.js';
import { DiscordProvider } from './providers/discord.js';
import { TelegramProvider } from './providers/telegram.js';

export class NotificationDispatcher {
  constructor(providers = [new DiscordProvider(), new TelegramProvider()]) {
    this.providers = providers;
  }

  async dispatch(env, { now = () => Date.now(), send = fetch } = {}) {
    const repo = new Repository(env.DB);
    const token = crypto.randomUUID();
    const currentTime = now();

    await repo.prune(currentTime);
    console.info('dispatch_pruned');

    const d = await repo.mutate(s => {
      prune(s, currentTime);
      return claimDelivery(s, currentTime, token);
    });
    console.info(d ? 'dispatch_claimed' : 'dispatch_no_due');
    if (!d) return null;

    // スロットの変更による無効化を再検証
    const checked = await repo.mutate(s => {
      if (s.delivery?.token !== token) return null;
      s.delivery.items = s.delivery.items.filter(i =>
        s.slots[i.key]?.generation === i.generation && s.slots[i.key]?.revision === i.revision
      );
      if (!s.delivery.items.length) {
        s.delivery = null;
        return null;
      }
      return structuredClone(s.delivery);
    });
    if (!checked) return null;

    const activeProviders = this.providers.filter(p => p.isConfigured(env));
    let result;

    if (!activeProviders.length) {
      result = { ok: false, permanent: true, code: 'notification_not_configured' };
    } else {
      const results = await Promise.all(
        activeProviders.map(p => p.send(checked, env, send))
      );
      const success = results.find(r => r.ok);
      if (success) {
        result = success;
      } else {
        result = results.find(r => r.permanent) || results[0];
      }
    }

    await repo.mutate(s => finishDelivery(s, token, currentTime, result));
    console.info('dispatch_result', result.ok ? 'sent' : result.code);
    return result;
  }
}

const defaultDispatcher = new NotificationDispatcher();
export async function dispatch(env, options) {
  return defaultDispatcher.dispatch(env, options);
}
