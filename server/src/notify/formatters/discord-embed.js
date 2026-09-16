import { formatPlainText, deliveryStyle } from './text.js';
export function formatDiscordPayload(delivery) {
  const style = deliveryStyle(delivery);
  return { allowed_mentions: { parse: [] }, embeds: [{ title: style.label, description: formatPlainText(delivery).slice(0, 4000), color: style.color }] };
}
