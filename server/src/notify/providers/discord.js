import { BaseProvider } from '../provider.js';
import { formatDiscordPayload } from '../formatters/discord-embed.js';

export class DiscordProvider extends BaseProvider {
  constructor() {
    super('discord');
  }

  isConfigured(env) {
    try {
      const url = new URL(env.DISCORD_WEBHOOK_URL);
      return url.protocol === 'https:' && url.hostname === 'discord.com' && !url.username && !url.password
        && /^\/api\/webhooks\/[0-9]+\/[A-Za-z0-9._-]+$/.test(url.pathname);
    } catch { return false; }
  }

  async send(delivery, env, sendFn = fetch) {
    if (!this.isConfigured(env)) return { ok: false, permanent: true, code: 'invalid_discord_webhook' };
    const webhookUrl = env.DISCORD_WEBHOOK_URL;
    const payload = formatDiscordPayload(delivery);

    try {
      const response = await sendFn(webhookUrl, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });

      if (response.status === 204 || response.status === 200) {
        return { ok: true, channel: this.name };
      }

      const status = Number(response.status);
      const retryHeader = response.headers?.get?.('Retry-After');
      let retryAfterMs = Number.isFinite(Number(retryHeader)) ? Math.max(0, Number(retryHeader)) * 1000
        : Math.max(0, Date.parse(retryHeader) - Date.now()) || 0;
      if (status === 429) {
        try { const body = await response.json(); retryAfterMs = Math.max(retryAfterMs, Number(body.retry_after) * 1000 || 0); } catch {}
      }
      return {
        ok: false,
        channel: this.name,
        code: `discord_${status}`,
        permanent: [400, 401, 403, 404].includes(status),
        retryAfter: retryAfterMs
      };
    } catch {
      return { ok: false, channel: this.name, code: 'transport', uncertain: true };
    }
  }
}
