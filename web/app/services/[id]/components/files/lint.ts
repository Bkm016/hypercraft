import { parseDocument } from "yaml";
import { parse as parseToml } from "smol-toml";

export type ConfigLang = "yaml" | "json" | "toml";

export interface LintError {
  /** 1 起 */
  line: number;
  /** 1 起 */
  column: number;
  message: string;
}

export function langOf(path: string): ConfigLang | null {
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase();
  if (ext === "yml" || ext === "yaml") return "yaml";
  if (ext === "json") return "json";
  if (ext === "toml") return "toml";
  return null;
}

/** 前端即时校验（保存时后端还会再校验一次） */
export function lintConfig(lang: ConfigLang, raw: string): LintError | null {
  const text = raw.replace(/^\uFEFF/, "");
  try {
    if (lang === "yaml") {
      const doc = parseDocument(text, { prettyErrors: true });
      const err = doc.errors[0];
      if (err) {
        return {
          line: err.linePos?.[0]?.line ?? 1,
          column: err.linePos?.[0]?.col ?? 1,
          message: err.message.split("\n")[0],
        };
      }
    } else if (lang === "toml") {
      parseToml(text);
    } else {
      JSON.parse(text);
    }
    return null;
  } catch (e) {
    const err = e as Error & { line?: number; column?: number };
    if (typeof err.line === "number") {
      return { line: err.line, column: err.column ?? 1, message: err.message.split("\n")[0] };
    }
    const m = /line (\d+) column (\d+)/.exec(err.message);
    return {
      line: m ? Number(m[1]) : 1,
      column: m ? Number(m[2]) : 1,
      message: err.message.split("\n")[0],
    };
  }
}
