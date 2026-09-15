import { repairLine } from '../../domain/akashi.js';

const labels = { expedition: '遠征', repair: '入渠', build: '建造', fatigue: '疲労回復見込み' };
const date = n => new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
}).format(n);

export function formatPlainText(delivery) {
  return delivery.items.map(i => {
    if (i.kind === 'akashi') {
      const isEarly = (i.offsetMs || 0) < 0;
      const prefix = isEarly ? '【事前通知】' : '';
      const action = i.milestones.includes('start') ? '開始予定（20分）' : ' 全回復見込み';
      const ships = i.repair.ships.map(ship => repairLine(ship, i.repair.start, i.at)).join('\n');
      return `${prefix}第${i.slot}艦隊 泊地修理${action}\nHP回復見込み\n${ships}`;
    }

    const prefix = i.type === 'correction' ? '【訂正】'
      : i.type === 'delayed' || delivery.attempt > 1 ? '【遅延通知】' : '';
    const title = i.kind === 'manual' ? `手動予約 ${i.name}`
      : `${labels[i.kind]} ${['expedition', 'fatigue'].includes(i.kind) ? '第' + i.slot + '艦隊' : '第' + i.slot + 'ドック'}${i.name ? ' ' + i.name : ''}`;

    let text = '';
    if (i.type === 'correction') {
      text = i.end ? `終了予定を${date(i.end)}に更新しました` : '終了予定の通知は不要になりました';
    } else if (i.early) {
      const sec = Math.abs(Math.round((i.offsetMs || 0) / 1000));
      text = `終了予定の事前通知です（予定：${date(i.end)}／設定：${sec}秒前）`;
    } else if (i.kind === 'fatigue') {
      text = `目標の疲労度に回復する見込みの時刻です（${date(i.end)}）。母港で実際の疲労度を確認してください。`;
    } else {
      text = `終了予定時刻になりました（${date(i.end)}）`;
    }

    return `${prefix}${title}\n${text}`;
  }).join('\n\n');
}
