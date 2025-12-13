/**
 * 格式化字节数
 * @param bytes 字节数
 * @param compact 紧凑模式 (100M vs 100.0 MB)
 */
export function formatBytes(bytes: number, compact = false): string {
  if (!bytes || bytes <= 0) return compact ? "0B" : "0 B";
  const k = 1024;
  const sizes = compact
    ? ["B", "K", "M", "G", "T"]
    : ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1
  );
  const value = bytes / Math.pow(k, i);

  if (compact) {
    return `${value >= 100 ? Math.round(value) : value.toFixed(1)}${sizes[i]}`;
  }
  return `${value.toFixed(1)} ${sizes[i]}`;
}
