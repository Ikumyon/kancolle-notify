import { formatPlainText } from './text.js';

const labels = { expedition: '遠征', repair: '入渠', build: '建造', fatigue: '疲労回復見込み' };
const date = n => new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
}).format(n);

export function formatDiscordPayload(delivery) {
  const plainText = formatPlainText(delivery);
  const embeds = delivery.items.map(i => {
    let color = 0x3498db; // 青 (通常)
    let titlePrefix = '';

    if (i.type === 'correction') {
      color = 0xe67e22; // オレンジ
      titlePrefix = '【訂正】';
    } else if (i.type === 'delayed' || delivery.attempt > 1) {
      color = 0xe74c3c; // 赤
      titlePrefix = '【遅延】';
    } else if (i.early) {
      color = 0x2ecc71; // 緑 (事前通知)
      titlePrefix = '【事前通知】';
    }

    const titleName = i.kind === 'manual' ? `手動予約: ${i.name}`
      : `${labels[i.kind]} ${['expedition', 'fatigue'].includes(i.kind) ? '第' + i.slot + '艦隊' : '第' + i.slot + 'ドック'}${i.name ? ' ' + i.name : ''}`;

    let description = '';
    if (i.type === 'correction') {
      description = i.end ? `終了予定時刻を更新しました` : '終了予定の通知は不要になりました';
    } else if (i.early) {
      const sec = Math.abs(Math.round((i.offsetMs || 0) / 1000));
      description = `終了予定の事前通知です（設定: ${sec}秒前）`;
    } else if (i.kind === 'fatigue') {
      description = `目標疲労度への回復見込みです。`;
    } else {
      description = `終了予定時刻になりました。`;
    }

    const fields = [];
    if (i.end) {
      fields.push({ name: '終了予定時刻', value: date(i.end), inline: true });
    }

    return {
      title: `${titlePrefix}${titleName}`,
      description,
      color,
      fields,
      timestamp: i.end ? new Date(i.end).toISOString() : new Date().toISOString()
    };
  });

  return {
    content: plainText,
    embeds: embeds.slice(0, 10) // Discord は最大 10 embeds
  };
}
