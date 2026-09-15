import { BaseProvider } from '../provider.js';
import { formatDiscordPayload } from '../formatters/discord-embed.js';

export class DiscordProvider extends BaseProvider {
  constructor() {
    super('discord');
  }

  isConfigured(env) {
    return Boolean(env?.DISCORD_WEBHOOK_URL);
  }

  async send(delivery, env, sendFn = fetch) {
    const webhookUrl = env.DISCORD_WEBHOOK_URL;
    const payload = formatDiscordPayload(delivery);

    try {
      const response = await sendFn(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });

      if (response.status === 204 || response.status === 200) {
        return { ok: true, channel: this.name };
      }

      const status = Number(response.status);
      const retryAfter = Number(response.headers?.get?.('Retry-After')) || 0;
      return {
        ok: false,
        channel: this.name,
        code: `discord_${status}`,
        permanent: [400, 401, 403, 404].includes(status),
        retryAfter: Math.max(0, retryAfter) * 1000
      };
    } catch {
      return { ok: false, channel: this.name, code: 'transport', uncertain: true };
    }
  }
}
