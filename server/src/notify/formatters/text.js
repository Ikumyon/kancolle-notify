export const labels = { expedition: '遠征', repair: '入渠', build: '建造', fatigue: '疲労回復', akashi: '泊地修理', manual: '手動予約' };
const date = value => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(value);
export const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function deliveryStyle(d) {
  if (d.type === 'correction') return { label: '訂正', color: 0xe67e22 };
  if (d.attempts > 1 || d.sentAt - d.dueAt > 60000) return { label: '遅延', color: 0xe74c3c };
  const end = d.eventEndAt;
  if (d.dueAt < end) return { label: '事前通知', color: 0x2ecc71 };
  return { label: '予定通知', color: 0x3498db };
}
export function formatPlainText(d) {
  const t = d.item, lines = [`【${deliveryStyle(d).label}】${labels[t.kind]} ${t.slot ? '第' + t.slot + (['repair', 'build'].includes(t.kind) ? 'ドック' : '艦隊') : ''} ${t.name || ''}`.trim()];
  const end = d.eventEndAt;
  if (d.type === 'correction') {
    lines.push(end ? '終了予定を更新しました' : 'この予定の通知は不要になりました');
  } else if (t.kind === 'akashi') {
    if (d.phase === 'start') {
      lines.push('最初の20分が経過する見込みです');
      if (d.text) lines.push(d.text);
    } else {
      lines.push(d.text ? `${d.text} 全回復の見込みです` : '艦隊の全回復見込みです');
    }
  } else if (t.kind === 'fatigue') {
    lines.push('目標condへの回復見込みです');
  } else {
    lines.push('終了予定のお知らせです');
  }
  if (end) lines.push('予定時刻: ' + date(end));
  return lines.join('\n');
}
