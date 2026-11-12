"use client";

/**
 * Markdown 渲染预览（只读）。
 * - GFM：表格、任务列表、删除线、自动链接、脚注
 * - 数学公式：$inline$ / $$block$$（KaTeX）
 * - Mermaid 图表：```mermaid 代码块（按需加载 mermaid）
 * - 代码块语法高亮（highlight.js）
 * - 内嵌 HTML（经 sanitize 过滤，去除脚本与事件属性）
 * - 相对路径图片从服务工作目录读取；相对路径链接在文件管理器中打开
 */
import { memo, useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import { useTheme } from "next-themes";
import "katex/dist/katex.min.css";
import "./markdown-preview.css";
import { api } from "@/lib/api";

/** 允许常见的排版 HTML，脚本 / 事件属性 / iframe 等仍被过滤 */
const schema = {
  ...defaultSchema,
  // 标题锚点由 rehype-slug 在过滤之后生成，这里不需要加 user-content- 前缀
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "align"],
    img: [...(defaultSchema.attributes?.img ?? []), "width", "height", "align"],
    code: [["className", /^language-./, "math-inline", "math-display"]],
    span: [...(defaultSchema.attributes?.span ?? []), ["className", "math-inline", "math-display"]],
    div: [...(defaultSchema.attributes?.div ?? []), ["className", "math-display"]],
  },
  tagNames: [...(defaultSchema.tagNames ?? []), "center", "u", "mark", "figure", "figcaption", "abbr"],
  protocols: { ...defaultSchema.protocols, src: ["http", "https", "data"] },
};

const REMARK = [remarkGfm, remarkMath];
const REHYPE = [
  rehypeRaw,
  [rehypeSanitize, schema],
  rehypeSlug,
  rehypeKatex,
  // mermaid / math 交给专门的渲染器，不做代码高亮
  [rehypeHighlight, { detect: false, plainText: ["mermaid", "math", "text", "txt", "plain"] }],
] as ComponentProps<typeof ReactMarkdown>["rehypePlugins"];

const isExternal = (url: string) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url);

/** 相对 Markdown 文件所在目录解析路径；以 / 开头视为工作目录根；越界返回 null */
function resolveRel(baseDir: string, url: string): string | null {
  const clean = decodeURIComponent(url.split(/[?#]/)[0]);
  const parts = clean.startsWith("/") ? [] : baseDir ? baseDir.split("/") : [];
  for (const seg of clean.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

/* ---------------- 图片：相对路径从工作目录读取 ---------------- */

function WorkspaceImage({ serviceId, path, alt, ...rest }: { serviceId: string; path: string } & ComponentProps<"img">) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    api
      .fetchServiceFileBlob(serviceId, path)
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [serviceId, path]);
  if (failed) return <span className="hc-md-broken">[图片无法加载：{path}]</span>;
  if (!src) return <span className="hc-md-img-loading">{alt || path}</span>;
  // biome-ignore lint/performance/noImgElement: 预览的是用户文件，不走 next/image
  return <img {...rest} src={src} alt={alt} />;
}

/* ---------------- Mermaid ---------------- */

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  if (!mermaidPromise) mermaidPromise = import("mermaid").then((m) => m.default);
  return mermaidPromise;
}

/** 多个图表串行渲染，避免 mermaid 全局配置互相干扰 */
let mermaidQueue: Promise<unknown> = Promise.resolve();

function Mermaid({ code, dark }: { code: string; dark: boolean }) {
  const id = `mmd-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const job = mermaidQueue.then(async () => {
      try {
        const mermaid = await loadMermaid();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "default",
          fontFamily: "inherit",
        });
        const { svg } = await mermaid.render(id, code);
        if (alive) {
          setSvg(svg);
          setError(null);
        }
      } catch (e) {
        document.getElementById(`d${id}`)?.remove();
        if (alive) setError((e as Error)?.message || String(e));
      }
    });
    mermaidQueue = job;
    return () => {
      alive = false;
    };
  }, [code, dark, id]);
  if (error) {
    return (
      <div className="hc-md-diagram-error">
        <div>Mermaid 图表渲染失败：{error.split("\n")[0]}</div>
        <pre>{code}</pre>
      </div>
    );
  }
  if (!svg) return <div className="hc-md-diagram hc-md-diagram-loading">正在渲染图表…</div>;
  // mermaid 以 strict 安全级别渲染，输出已做过净化
  return <div className="hc-md-diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/* ---------------- 主组件 ---------------- */

export interface MarkdownPreviewProps {
  serviceId: string;
  /** 当前 Markdown 文件路径（相对工作目录），用于解析相对图片 / 链接 */
  path: string;
  content: string;
  /** 工作区主题是否暗色；null 表示跟随界面 */
  dark: boolean | null;
  /** 打开工作目录内的另一个文件（相对链接） */
  onOpenPath?: (path: string) => void;
}

function MarkdownPreviewImpl({ serviceId, path, content, dark, onOpenPath }: MarkdownPreviewProps) {
  const { resolvedTheme } = useTheme();
  const isDark = dark ?? resolvedTheme === "dark";
  const baseDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const rootRef = useRef<HTMLDivElement>(null);

  const components: Components = {
    a({ href = "", children, node: _node, ...rest }) {
      if (href.startsWith("#")) {
        return (
          <a
            {...rest}
            href={href}
            onClick={(e) => {
              e.preventDefault();
              const target = rootRef.current?.querySelector(`#${CSS.escape(decodeURIComponent(href.slice(1)))}`);
              target?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            {children}
          </a>
        );
      }
      if (isExternal(href)) {
        return (
          <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }
      const target = resolveRel(baseDir, href);
      return (
        <a
          {...rest}
          href={href}
          title={target ? `在文件管理器中打开 /${target}` : undefined}
          onClick={(e) => {
            e.preventDefault();
            if (target && onOpenPath) onOpenPath(target);
          }}
        >
          {children}
        </a>
      );
    },
    img({ src, alt, node: _node, ...rest }) {
      const s = typeof src === "string" ? src : "";
      if (!s) return null;
      if (isExternal(s)) {
        // biome-ignore lint/performance/noImgElement: 预览的是用户文件，不走 next/image
        return <img {...rest} src={s} alt={alt} loading="lazy" referrerPolicy="no-referrer" />;
      }
      const p = resolveRel(baseDir, s);
      if (p === null) return <span className="hc-md-broken">[图片路径超出工作目录：{s}]</span>;
      return <WorkspaceImage {...rest} serviceId={serviceId} path={p} alt={alt} />;
    },
    pre({ children, node, ...rest }) {
      // ```mermaid 代码块：渲染为图表
      const code = node?.children?.[0];
      if (code && code.type === "element" && code.tagName === "code") {
        const cls = code.properties?.className;
        const classes = Array.isArray(cls) ? cls.map(String) : [];
        if (classes.includes("language-mermaid")) {
          const text = code.children.map((c) => (c.type === "text" ? c.value : "")).join("");
          return <Mermaid code={text.trimEnd()} dark={isDark} />;
        }
      }
      return <pre {...rest}>{children as ReactNode}</pre>;
    },
    table({ children, node: _node, ...rest }) {
      return (
        <div className="hc-md-table">
          <table {...rest}>{children}</table>
        </div>
      );
    },
  };

  return (
    <div ref={rootRef} className="hc-md-scroll h-full overflow-auto">
      <article className={`hc-md ${isDark ? "hc-md-dark" : ""}`}>
        {content.trim() ? (
          <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={components}>
            {content}
          </ReactMarkdown>
        ) : (
          <p className="hc-md-empty">空文档，切换到「编辑」开始书写。</p>
        )}
      </article>
    </div>
  );
}

export const MarkdownPreview = memo(MarkdownPreviewImpl);
export default MarkdownPreview;
