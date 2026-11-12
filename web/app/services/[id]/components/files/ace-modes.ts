/**
 * 按文件名选择 Ace 语法高亮模式，模式脚本按需动态加载（不打进首屏）。
 * 识别不了的文件用纯文本模式打开——高亮只是锦上添花，任何文本都能编辑。
 */
import type { Ace } from "ace-builds";

/** 常见但 Ace 默认映射不到的文件名 / 扩展名（Minecraft 与运维场景） */
const EXTRA: Record<string, string> = {
  // 扩展名
  cfg: "ini",
  conf: "ini",
  ini: "ini",
  env: "sh",
  mcmeta: "json",
  json5: "json5",
  jsonc: "json",
  mcfunction: "sh",
  lang: "properties",
  log: "text",
  out: "text",
  service: "ini",
  bash: "sh",
  zsh: "sh",
  command: "sh",
  ps1: "powershell",
  bat: "batchfile",
  cmd: "batchfile",
  gradle: "groovy",
  kts: "kotlin",
  // 完整文件名（小写）
  dockerfile: "dockerfile",
  makefile: "makefile",
  ".env": "sh",
  ".gitignore": "gitignore",
  ".dockerignore": "gitignore",
  "eula.txt": "properties",
  "server.properties": "properties",
};

let modelist: Promise<{ getModeForPath: (p: string) => { name: string; mode: string } }> | null = null;
function loadModelist() {
  if (!modelist) {
    modelist = import("ace-builds/src-noconflict/ext-modelist").then(
      () => (window as unknown as { ace: { require: (m: string) => never } }).ace.require("ace/ext/modelist"),
    );
  }
  return modelist;
}

/** 返回 Ace 模式名（如 "yaml"、"java"、"text"） */
export async function modeForPath(path: string): Promise<string> {
  const name = (path.split("/").pop() || path).toLowerCase();
  if (EXTRA[name]) return EXTRA[name];
  const ext = /\.([^./]+)$/.exec(name)?.[1];
  if (ext && EXTRA[ext]) return EXTRA[ext];
  try {
    const ml = await loadModelist();
    return ml.getModeForPath(name).name || "text";
  } catch {
    return "text";
  }
}

/**
 * 给编辑器设置模式；模式脚本按需加载，失败则退回纯文本。
 * 加载是异步的：期间编辑器可能已被销毁（切换文件）或又切换了模式，
 * 因此只在编辑器仍存活且这是最新一次请求时才应用。
 */
const pending = new WeakMap<Ace.Editor, string>();
export async function applyMode(editor: Ace.Editor, wanted: string) {
  pending.set(editor, wanted);
  let mode = wanted;
  if (mode !== "text") {
    try {
      await import(
        /* webpackChunkName: "ace-mode-[request]" */ `ace-builds/src-noconflict/mode-${mode}.js`
      );
    } catch {
      mode = "text";
    }
  }
  const requested = pending.get(editor);
  const ed = editor as unknown as { destroyed?: boolean; session?: { destroyed?: boolean } };
  // 编辑器 / 会话已销毁，或期间又请求了别的模式：放弃本次设置
  if (ed.destroyed || !ed.session || ed.session.destroyed) return;
  if (requested !== wanted) return;
  try {
    editor.session.setMode(`ace/mode/${mode}`);
  } catch {
    // 编辑器在设置过程中被销毁，忽略
  }
}

/** 状态栏显示用的模式名称 */
export function modeLabel(mode: string) {
  const known: Record<string, string> = {
    yaml: "YAML",
    json: "JSON",
    json5: "JSON5",
    toml: "TOML",
    properties: "Properties",
    ini: "INI",
    sh: "Shell",
    batchfile: "Batch",
    powershell: "PowerShell",
    java: "Java",
    javascript: "JavaScript",
    typescript: "TypeScript",
    python: "Python",
    xml: "XML",
    html: "HTML",
    markdown: "Markdown",
    dockerfile: "Dockerfile",
    sql: "SQL",
    groovy: "Groovy",
    kotlin: "Kotlin",
    lua: "Lua",
    text: "纯文本",
    gitignore: "Gitignore",
  };
  return known[mode] ?? mode.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
