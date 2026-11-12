"use client";

// 仅在浏览器加载（ace 依赖 window），由 file-editor 通过 next/dynamic 引入
import AceEditor from "react-ace";
import type { Ace } from "ace-builds";
import ace from "ace-builds/src-noconflict/ace";
import "ace-builds/src-noconflict/mode-yaml";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/mode-toml";
import "ace-builds/src-noconflict/theme-one_dark";
import "ace-builds/src-noconflict/ext-searchbox";
import type { ConfigLang, LintError } from "./lint";

// 关闭 ace 内置 worker：校验统一由 lint.ts 完成，也避免额外的 worker 资源请求
ace.config.set("useWorker", false);

export interface AceConfigEditorProps {
  lang: ConfigLang;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  error: LintError | null;
  readOnly?: boolean;
  onLoad?: (editor: Ace.Editor) => void;
}

export default function AceConfigEditor({ lang, value, onChange, onSave, error, readOnly, onLoad }: AceConfigEditorProps) {
  return (
    <AceEditor
      mode={lang}
      theme="one_dark"
      value={value}
      onChange={onChange}
      onLoad={onLoad}
      readOnly={readOnly}
      width="100%"
      height="100%"
      fontSize={13}
      showPrintMargin={false}
      editorProps={{ $blockScrolling: true }}
      setOptions={{ useWorker: false, tabSize: 2, useSoftTabs: true, fontFamily: "Menlo, Consolas, monospace" }}
      commands={[
        { name: "save", bindKey: { win: "Ctrl-S", mac: "Command-S" }, exec: () => onSave() },
      ]}
      annotations={error ? [{ row: error.line - 1, column: Math.max(0, error.column - 1), type: "error", text: error.message }] : []}
    />
  );
}
