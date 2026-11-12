"use client";

// 仅在浏览器加载（ace 依赖 window），由 file-editor 通过 next/dynamic 引入
import AceEditor from "react-ace";
import type { Ace } from "ace-builds";
import ace from "ace-builds/src-noconflict/ace";
import "ace-builds/src-noconflict/mode-text";
import "ace-builds/src-noconflict/ext-searchbox";
import "ace-builds/src-noconflict/theme-github_light_default";
import "ace-builds/src-noconflict/theme-solarized_light";
import "ace-builds/src-noconflict/theme-github_dark";
import "ace-builds/src-noconflict/theme-one_dark";
import "ace-builds/src-noconflict/theme-dracula";
import "ace-builds/src-noconflict/theme-nord_dark";
import "ace-builds/src-noconflict/theme-monokai";
import "ace-builds/src-noconflict/theme-solarized_dark";
import "ace-builds/src-noconflict/theme-tomorrow_night_eighties";
import { registerHypercraftTheme } from "./ace-theme-hypercraft";
import type { LintError } from "./lint";
import { applyMode } from "./ace-modes";
import { useEffect, useRef } from "react";

// 关闭 ace 内置 worker：校验统一由 lint.ts 完成，也避免额外的 worker 资源请求
ace.config.set("useWorker", false);
registerHypercraftTheme();

export interface AceConfigEditorProps {
  /** Ace 模式名（yaml / java / text ...），由 ace-modes 按文件名得出 */
  mode: string;
  /** 软换行（日志、长文本） */
  wrap?: boolean;
  /** Ace 主题名，如 hypercraft / one_dark */
  theme: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  error: LintError | null;
  readOnly?: boolean;
  onLoad?: (editor: Ace.Editor) => void;
  onCursorChange?: (line: number, column: number) => void;
}

export default function AceConfigEditor({
  mode,
  wrap,
  theme,
  value,
  onChange,
  onSave,
  error,
  readOnly,
  onLoad,
  onCursorChange,
}: AceConfigEditorProps) {
  const editorRef = useRef<Ace.Editor | null>(null);
  // 模式脚本按需动态加载，避免把 200 种语法全部打进首屏
  useEffect(() => {
    if (editorRef.current) applyMode(editorRef.current, mode);
  }, [mode]);
  return (
    <AceEditor
      mode="text"
      theme={theme}
      value={value}
      onChange={onChange}
      onLoad={(ed) => {
        editorRef.current = ed;
        ed.renderer.setPadding(12);
        applyMode(ed, mode);
        onLoad?.(ed);
      }}
      onCursorChange={(sel: Ace.Selection) => {
        const c = sel.getCursor();
        onCursorChange?.(c.row + 1, c.column + 1);
      }}
      readOnly={readOnly}
      width="100%"
      height="100%"
      fontSize={13}
      showPrintMargin={false}
      highlightActiveLine
      editorProps={{ $blockScrolling: true }}
      setOptions={{
        useWorker: false,
        tabSize: 2,
        useSoftTabs: true,
        fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        displayIndentGuides: true,
        highlightGutterLine: true,
        fixedWidthGutter: true,
        showFoldWidgets: true,
        scrollPastEnd: true,
        wrap: !!wrap,
      }}
      commands={[{ name: "save", bindKey: { win: "Ctrl-S", mac: "Command-S" }, exec: () => onSave() }]}
      annotations={
        error ? [{ row: error.line - 1, column: Math.max(0, error.column - 1), type: "error", text: error.message }] : []
      }
    />
  );
}
