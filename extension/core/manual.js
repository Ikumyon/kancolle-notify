// datetime-local is explicitly interpreted as JST, never as the PC timezone.
export function jstTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('invalid_manual');
  const ms = Date.parse(value + ':00+09:00');
  if (!Number.isFinite(ms) || new Date(ms + 9 * 3600000).toISOString().slice(0, 16) !== value) throw new Error('invalid_manual');
  return ms;
}
