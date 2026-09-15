import { BaseProvider } from '../provider.js';
import { formatPlainText } from '../formatters/text.js';

export class TelegramProvider extends BaseProvider {
  constructor() {
    super('telegram');
  }

  isConfigured(env) {
    return Boolean(env?.TELEGRAM_BOT_TOKEN && env?.TELEGRAM_CHAT_ID);
  }

  async send(delivery, env, sendFn = fetch) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    const text = formatPlainText(delivery);

    try {
      const response = await sendFn(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(15000)
      });

      const body = await response.json();
      const status = Number(body.error_code || response.status);

      if (response.ok && body.ok) {
        return { ok: true, channel: this.name, messageId: body.result?.message_id };
      }

      return {
        ok: false,
        channel: this.name,
        code: `telegram_${status}`,
        permanent: [400, 401, 403, 404].includes(status),
        retryAfter: Math.max(0, Number(body.parameters?.retry_after) || 0) * 1000
      };
    } catch {
      return { ok: false, channel: this.name, code: 'transport', uncertain: true };
    }
  }
}
