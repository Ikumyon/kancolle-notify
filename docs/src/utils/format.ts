/**
 * バイト数を人間が読みやすい単位（KB, MB, GB）にフォーマットします。
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!+bytes || bytes < 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i] || "B"}`;
}
