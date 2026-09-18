import { BaseProvider } from '../provider.js';
import { formatPlainText, escapeHtml } from '../formatters/text.js';

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
    const text = '<b>艦これ通知</b>\n' + escapeHtml(formatPlainText(delivery));

    try {
      const fetcher = typeof sendFn === 'function' ? (...args) => sendFn.call(globalThis, ...args) : fetch;
      const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
      });

      const body = await response.json();
      const status = Number(body.error_code || response.status);

      if (response.ok && body.ok) {
        return { ok: true, channel: this.name, messageId: body.result?.message_id };
      }

      console.error('[telegram] API error response:', body);
      return {
        ok: false,
        channel: this.name,
        code: `telegram_${status}`,
        permanent: [400, 401, 403, 404].includes(status),
        retryAfter: Math.max(0, Number(body.parameters?.retry_after) || 0) * 1000
      };
    } catch (e) {
      console.error('[telegram] send exception:', e);
      return { ok: false, channel: this.name, code: 'transport', uncertain: true };
    }
  }
}
