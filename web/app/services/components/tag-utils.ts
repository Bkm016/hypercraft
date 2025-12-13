/**
 * 标签工具函数
 * 标签格式: "tag_name" 或 "tag_name;#FFFFFF"
 * 分号后面是可选的颜色值
 */

export interface ParsedTag {
  name: string;
  color: string | null;
  raw: string;
}

// 默认颜色 (当没有指定颜色时)
export const DEFAULT_COLOR = "#6b7280"; // gray-500

// 统一的预设颜色（用于标签、分组、快捷指令等）
export const PRESET_COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
];

// 兼容旧名称
export const DEFAULT_TAG_COLOR = DEFAULT_COLOR;
export const TAG_PRESET_COLORS = PRESET_COLORS;

/**
 * 解析标签字符串
 * @param raw 原始标签字符串，如 "production" 或 "production;#22c55e"
 * @returns 解析后的标签对象
 */
export function parseTag(raw: string): ParsedTag {
  const parts = raw.split(";");
  const name = parts[0].trim();
  let color: string | null = null;

  if (parts.length > 1 && parts[1]) {
    const colorPart = parts[1].trim();
    // 验证颜色格式
    if (/^#[0-9A-Fa-f]{6}$/.test(colorPart) || /^#[0-9A-Fa-f]{3}$/.test(colorPart)) {
      color = colorPart;
    }
  }

  return { name, color, raw };
}

/**
 * 组合标签名和颜色为原始字符串
 * @param name 标签名
 * @param color 颜色值 (可选)
 * @returns 组合后的字符串
 */
export function serializeTag(name: string, color: string | null): string {
  if (!color || color === DEFAULT_TAG_COLOR) {
    return name;
  }
  return `${name};${color}`;
}

/**
 * 解析标签数组
 */
export function parseTags(rawTags: string[]): ParsedTag[] {
  return rawTags.map(parseTag);
}

/**
 * 获取标签的显示颜色
 */
export function getTagColor(tag: ParsedTag): string {
  return tag.color || DEFAULT_TAG_COLOR;
}

/**
 * 获取标签颜色的 alpha 版本 (用于背景)
 */
export function getTagBgColor(tag: ParsedTag): string {
  const color = getTagColor(tag);
  return `${color}1a`; // 10% alpha
}

/**
 * 从 allTags 中获取唯一的标签名列表（用于过滤等）
 * 这个函数会去除颜色信息，只返回标签名
 */
export function getUniqueTagNames(rawTags: string[]): string[] {
  const parsed = parseTags(rawTags);
  const names = new Set(parsed.map((t) => t.name));
  return Array.from(names).sort();
}

/**
 * 在 allTags 中查找具有特定名称的标签（保留颜色信息）
 */
export function findTagByName(rawTags: string[], name: string): string | null {
  const parsed = parseTags(rawTags);
  const found = parsed.find((t) => t.name === name);
  return found ? found.raw : null;
}

/**
 * 判断两个标签是否匹配（只比较名称，忽略颜色）
 */
export function tagsMatch(tag1: string, tag2: string): boolean {
  return parseTag(tag1).name === parseTag(tag2).name;
}
