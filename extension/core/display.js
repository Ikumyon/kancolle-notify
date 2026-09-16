export const time = value => Number.isFinite(value) && value > 0 ? new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
}).format(value) : '未観測';
export function remainingText(endAt, now) {
  if (!Number.isFinite(endAt) || !Number.isFinite(now)) return '未観測';
  const seconds = Math.max(0, Math.ceil((endAt - now) / 1000));
  return Math.floor(seconds / 3600) + '時間 ' + Math.floor(seconds % 3600 / 60) + '分 ' + seconds % 60 + '秒';
}
export const statusLabels = { queued: '送信待ち', sending: '送信中', sent: '送信済み', retry: '再送待ち', stopped: '送信停止' };
