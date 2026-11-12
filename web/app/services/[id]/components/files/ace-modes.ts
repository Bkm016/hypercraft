/**
 * 按文件名选择 Ace 语法高亮模式，模式脚本按需动态加载（不打进首屏）。
 * 识别不了的文件用纯文本模式打开——高亮只是锦上添花，任何文本都能编辑。
 *
 * 注意：
 * - Ace 的 mode-*.js 依赖全局 `ace`，必须先加载 ace 本体再加载模式脚本；
 * - 打包器（Turbopack / webpack）对模板字符串形式的动态 import 支持不一致，
 *   这里为每个模式写明确的 import()，保证每个模式都能被正确拆包和加载。
 */
import type { Ace } from "ace-builds";

type Loader = () => Promise<unknown>;

/** 支持高亮的模式 → 加载器 */
const LOADERS: Record<string, Loader> = {
  yaml: () => import("ace-builds/src-noconflict/mode-yaml"),
  json: () => import("ace-builds/src-noconflict/mode-json"),
  json5: () => import("ace-builds/src-noconflict/mode-json5"),
  hjson: () => import("ace-builds/src-noconflict/mode-hjson"),
  toml: () => import("ace-builds/src-noconflict/mode-toml"),
  properties: () => import("ace-builds/src-noconflict/mode-properties"),
  ini: () => import("ace-builds/src-noconflict/mode-ini"),
  markdown: () => import("ace-builds/src-noconflict/mode-markdown"),
  xml: () => import("ace-builds/src-noconflict/mode-xml"),
  html: () => import("ace-builds/src-noconflict/mode-html"),
  css: () => import("ace-builds/src-noconflict/mode-css"),
  scss: () => import("ace-builds/src-noconflict/mode-scss"),
  less: () => import("ace-builds/src-noconflict/mode-less"),
  svg: () => import("ace-builds/src-noconflict/mode-svg"),
  javascript: () => import("ace-builds/src-noconflict/mode-javascript"),
  typescript: () => import("ace-builds/src-noconflict/mode-typescript"),
  jsx: () => import("ace-builds/src-noconflict/mode-jsx"),
  tsx: () => import("ace-builds/src-noconflict/mode-tsx"),
  sh: () => import("ace-builds/src-noconflict/mode-sh"),
  batchfile: () => import("ace-builds/src-noconflict/mode-batchfile"),
  powershell: () => import("ace-builds/src-noconflict/mode-powershell"),
  python: () => import("ace-builds/src-noconflict/mode-python"),
  java: () => import("ace-builds/src-noconflict/mode-java"),
  kotlin: () => import("ace-builds/src-noconflict/mode-kotlin"),
  groovy: () => import("ace-builds/src-noconflict/mode-groovy"),
  scala: () => import("ace-builds/src-noconflict/mode-scala"),
  c_cpp: () => import("ace-builds/src-noconflict/mode-c_cpp"),
  csharp: () => import("ace-builds/src-noconflict/mode-csharp"),
  golang: () => import("ace-builds/src-noconflict/mode-golang"),
  rust: () => import("ace-builds/src-noconflict/mode-rust"),
  ruby: () => import("ace-builds/src-noconflict/mode-ruby"),
  php: () => import("ace-builds/src-noconflict/mode-php"),
  perl: () => import("ace-builds/src-noconflict/mode-perl"),
  lua: () => import("ace-builds/src-noconflict/mode-lua"),
  sql: () => import("ace-builds/src-noconflict/mode-sql"),
  dockerfile: () => import("ace-builds/src-noconflict/mode-dockerfile"),
  makefile: () => import("ace-builds/src-noconflict/mode-makefile"),
  nginx: () => import("ace-builds/src-noconflict/mode-nginx"),
  apache_conf: () => import("ace-builds/src-noconflict/mode-apache_conf"),
  gitignore: () => import("ace-builds/src-noconflict/mode-gitignore"),
  csv: () => import("ace-builds/src-noconflict/mode-csv"),
  tsv: () => import("ace-builds/src-noconflict/mode-tsv"),
  diff: () => import("ace-builds/src-noconflict/mode-diff"),
  vue: () => import("ace-builds/src-noconflict/mode-vue"),
  terraform: () => import("ace-builds/src-noconflict/mode-terraform"),
  protobuf: () => import("ace-builds/src-noconflict/mode-protobuf"),
  graphqlschema: () => import("ace-builds/src-noconflict/mode-graphqlschema"),
  latex: () => import("ace-builds/src-noconflict/mode-latex"),
  rst: () => import("ace-builds/src-noconflict/mode-rst"),
  asciidoc: () => import("ace-builds/src-noconflict/mode-asciidoc"),
  dart: () => import("ace-builds/src-noconflict/mode-dart"),
  swift: () => import("ace-builds/src-noconflict/mode-swift"),
  r: () => import("ace-builds/src-noconflict/mode-r"),
  nix: () => import("ace-builds/src-noconflict/mode-nix"),
  zig: () => import("ace-builds/src-noconflict/mode-zig"),
  prisma: () => import("ace-builds/src-noconflict/mode-prisma"),
  handlebars: () => import("ace-builds/src-noconflict/mode-handlebars"),
  twig: () => import("ace-builds/src-noconflict/mode-twig"),
  velocity: () => import("ace-builds/src-noconflict/mode-velocity"),
  ftl: () => import("ace-builds/src-noconflict/mode-ftl"),
  haskell: () => import("ace-builds/src-noconflict/mode-haskell"),
  elixir: () => import("ace-builds/src-noconflict/mode-elixir"),
  erlang: () => import("ace-builds/src-noconflict/mode-erlang"),
  clojure: () => import("ace-builds/src-noconflict/mode-clojure"),
  fsharp: () => import("ace-builds/src-noconflict/mode-fsharp"),
  vbscript: () => import("ace-builds/src-noconflict/mode-vbscript"),
  autohotkey: () => import("ace-builds/src-noconflict/mode-autohotkey"),
};

/** 扩展名 → 模式 */
const BY_EXT: Record<string, string> = {
  // 配置
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  jsonc: "json",
  mcmeta: "json",
  geojson: "json",
  webmanifest: "json",
  json5: "json5",
  hjson: "hjson",
  toml: "toml",
  properties: "properties",
  lang: "properties",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  config: "xml",
  service: "ini",
  timer: "ini",
  socket: "ini",
  desktop: "ini",
  editorconfig: "ini",
  env: "sh",
  // 文档
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  rst: "rst",
  adoc: "asciidoc",
  tex: "latex",
  // 标记 / 样式
  xml: "xml",
  xsd: "xml",
  xsl: "xml",
  pom: "xml",
  plist: "xml",
  html: "html",
  htm: "html",
  xhtml: "html",
  svg: "svg",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  vue: "vue",
  // 脚本
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  jsx: "jsx",
  tsx: "tsx",
  sh: "sh",
  bash: "sh",
  zsh: "sh",
  ksh: "sh",
  command: "sh",
  mcfunction: "sh",
  bat: "batchfile",
  cmd: "batchfile",
  ps1: "powershell",
  psm1: "powershell",
  py: "python",
  pyw: "python",
  rb: "ruby",
  php: "php",
  pl: "perl",
  pm: "perl",
  lua: "lua",
  sql: "sql",
  ahk: "autohotkey",
  vbs: "vbscript",
  // 编程语言
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  groovy: "groovy",
  gradle: "groovy",
  scala: "scala",
  sc: "scala",
  c: "c_cpp",
  h: "c_cpp",
  cc: "c_cpp",
  cpp: "c_cpp",
  cxx: "c_cpp",
  hpp: "c_cpp",
  cs: "csharp",
  go: "golang",
  rs: "rust",
  dart: "dart",
  swift: "swift",
  r: "r",
  nix: "nix",
  zig: "zig",
  hs: "haskell",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  clj: "clojure",
  fs: "fsharp",
  // 其他
  dockerfile: "dockerfile",
  mk: "makefile",
  tf: "terraform",
  hcl: "terraform",
  proto: "protobuf",
  graphql: "graphqlschema",
  gql: "graphqlschema",
  prisma: "prisma",
  hbs: "handlebars",
  twig: "twig",
  vm: "velocity",
  ftl: "ftl",
  csv: "csv",
  tsv: "tsv",
  diff: "diff",
  patch: "diff",
  gitignore: "gitignore",
  dockerignore: "gitignore",
  // 纯文本
  txt: "text",
  log: "text",
  out: "text",
};

/** 完整文件名（小写） → 模式，优先于扩展名 */
const BY_NAME: Record<string, string> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  jenkinsfile: "groovy",
  vagrantfile: "ruby",
  gemfile: "ruby",
  rakefile: "ruby",
  ".env": "sh",
  ".bashrc": "sh",
  ".zshrc": "sh",
  ".profile": "sh",
  ".gitignore": "gitignore",
  ".dockerignore": "gitignore",
  ".npmignore": "gitignore",
  ".gitattributes": "gitignore",
  ".editorconfig": "ini",
  ".npmrc": "ini",
  ".gitconfig": "ini",
  "nginx.conf": "nginx",
  "httpd.conf": "apache_conf",
  ".htaccess": "apache_conf",
  "eula.txt": "properties",
  "server.properties": "properties",
  "cmakelists.txt": "makefile",
};

/** 返回 Ace 模式名（如 "yaml"、"java"、"text"） */
export function modeForPath(path: string): string {
  const name = (path.split("/").pop() || path).toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  // .env.local / docker-compose.override.yml 之类：先看完整名，再看最后一个扩展名
  if (name.startsWith(".env")) return "sh";
  if (name.startsWith("dockerfile.") || name.endsWith(".dockerfile")) return "dockerfile";
  const ext = /\.([^./]+)$/.exec(name)?.[1];
  if (ext && BY_EXT[ext]) return BY_EXT[ext];
  return "text";
}

let aceReady: Promise<unknown> | null = null;
/** 模式脚本依赖全局 ace，先确保 ace 本体已加载 */
function ensureAce() {
  if (!aceReady) aceReady = import("ace-builds/src-noconflict/ace");
  return aceReady;
}

const loaded = new Map<string, Promise<boolean>>();
/** 加载模式脚本，成功返回 true；同一模式只加载一次 */
export function loadMode(mode: string): Promise<boolean> {
  const loader = LOADERS[mode];
  if (!loader) return Promise.resolve(false);
  let p = loaded.get(mode);
  if (!p) {
    p = ensureAce()
      .then(loader)
      .then(() => true)
      .catch((e) => {
        console.warn(`[files] 加载 Ace 模式 ${mode} 失败`, e);
        loaded.delete(mode);
        return false;
      });
    loaded.set(mode, p);
  }
  return p;
}

/**
 * 给编辑器设置模式；模式脚本按需加载，失败则退回纯文本。
 * 加载是异步的：期间编辑器可能已被销毁（切换文件）或又切换了模式，
 * 因此只在编辑器仍存活且这是最新一次请求时才应用。
 */
const pending = new WeakMap<Ace.Editor, string>();
export async function applyMode(editor: Ace.Editor, wanted: string) {
  pending.set(editor, wanted);
  const ok = wanted !== "text" && (await loadMode(wanted));
  const mode = ok ? wanted : "text";
  const ed = editor as unknown as { destroyed?: boolean; session?: { destroyed?: boolean; $modeId?: string } };
  // 编辑器 / 会话已销毁，或期间又请求了别的模式：放弃本次设置
  if (ed.destroyed || !ed.session || ed.session.destroyed) return;
  if (pending.get(editor) !== wanted) return;
  if (ed.session.$modeId === `ace/mode/${mode}`) return;
  try {
    editor.session.setMode(`ace/mode/${mode}`);
  } catch {
    // 编辑器在设置过程中被销毁，忽略
  }
}

const LABELS: Record<string, string> = {
  yaml: "YAML",
  json: "JSON",
  json5: "JSON5",
  hjson: "HJSON",
  toml: "TOML",
  properties: "Properties",
  ini: "INI",
  markdown: "Markdown",
  xml: "XML",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  less: "Less",
  svg: "SVG",
  javascript: "JavaScript",
  typescript: "TypeScript",
  jsx: "JSX",
  tsx: "TSX",
  sh: "Shell",
  batchfile: "Batch",
  powershell: "PowerShell",
  python: "Python",
  java: "Java",
  kotlin: "Kotlin",
  groovy: "Groovy",
  c_cpp: "C / C++",
  csharp: "C#",
  golang: "Go",
  sql: "SQL",
  dockerfile: "Dockerfile",
  makefile: "Makefile",
  nginx: "Nginx",
  apache_conf: "Apache",
  gitignore: "Ignore",
  csv: "CSV",
  tsv: "TSV",
  graphqlschema: "GraphQL",
  latex: "LaTeX",
  rst: "reStructuredText",
  asciidoc: "AsciiDoc",
  text: "纯文本",
};

/** 状态栏显示用的模式名称 */
export function modeLabel(mode: string) {
  return LABELS[mode] ?? mode.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
