/** 工具显示名与说明（与后端 FEATURED_TOOLS 对齐） */
export const TOOL_META: Record<string, { label: string; hint?: string }> = {
  java: { label: "Java", hint: "Minecraft 服务端 / 插件" },
  node: { label: "Node.js", hint: "机器人、Web 服务、构建脚本" },
  python: { label: "Python", hint: "脚本与工具" },
  go: { label: "Go" },
  bun: { label: "Bun" },
  deno: { label: "Deno" },
  maven: { label: "Maven", hint: "需同时选择 Java" },
  gradle: { label: "Gradle", hint: "需同时选择 Java" },
  rust: { label: "Rust" },
  ruby: { label: "Ruby" },
  php: { label: "PHP" },
  dotnet: { label: ".NET" },
};

export function toolLabel(tool: string): string {
  return TOOL_META[tool]?.label ?? tool;
}
