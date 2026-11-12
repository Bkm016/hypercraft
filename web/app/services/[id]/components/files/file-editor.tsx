"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Ace } from "ace-builds";
import {
  RiArrowGoBackLine,
  RiArrowLeftLine,
  RiCheckLine,
  RiCloseLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiRefreshLine,
  RiSave3Line,
} from "@remixicon/react";
import * as Button from "@/components/ui/button";
import { notification } from "@/hooks/use-notification";
import { api, type ApiError } from "@/lib/api";
import { langOf, lintConfig, type LintError } from "./lint";

const AceConfigEditor = dynamic(() => import("./ace-editor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <RiLoader4Line className="size-6 animate-spin text-neutral-500" />
    </div>
  ),
});

export interface FileEditorProps {
  serviceId: string;
  path: string;
  canWrite: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSaved?: () => void;
  onClose: () => void;
}

type Status =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

type Message =
  | { kind: "saved"; at: Date }
  | { kind: "conflict" }
  | { kind: "error"; text: string }
  | null;

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function FileEditor({ serviceId, path, canWrite, onDirtyChange, onSaved, onClose }: FileEditorProps) {
  const lang = langOf(path);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [value, setValue] = useState("");
  const [original, setOriginal] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [serverError, setServerError] = useState<LintError | null>(null);
  const etagRef = useRef<string | null>(null);
  const editorRef = useRef<Ace.Editor | null>(null);

  const load = useCallback(async () => {
    setStatus({ kind: "loading" });
    setMessage(null);
    setServerError(null);
    try {
      const file = await api.readServiceFile(serviceId, path);
      etagRef.current = file.etag;
      setValue(file.content);
      setOriginal(file.content);
      setStatus({ kind: "ready" });
    } catch (err) {
      setStatus({ kind: "error", message: (err as ApiError).message || "读取文件失败" });
    }
  }, [serviceId, path]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = status.kind === "ready" && value !== original;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  // 小文件即时校验；大文件防抖，避免每次按键整体解析几 MB 的文本
  const [lintError, setLintError] = useState<LintError | null>(null);
  useEffect(() => {
    if (!lang || status.kind !== "ready") {
      setLintError(null);
      return;
    }
    if (value.length < 200_000) {
      setLintError(lintConfig(lang, value));
      return;
    }
    const t = setTimeout(() => setLintError(lintConfig(lang, value)), value.length < 2_000_000 ? 300 : 800);
    return () => clearTimeout(t);
  }, [lang, value, status.kind]);
  // 编辑后清掉上一次服务端返回的错误位置
  useEffect(() => {
    setServerError(null);
  }, [value]);
  const shownError = lintError ?? serverError;

  const save = useCallback(
    async (force = false) => {
      if (!canWrite || !dirty || saving) return;
      // 保存时同步校验一次，不依赖防抖结果
      const err = lang ? lintConfig(lang, value) : null;
      setLintError(err);
      if (err) {
        editorRef.current?.gotoLine(err.line, Math.max(0, err.column - 1), true);
        editorRef.current?.focus();
        setMessage({ kind: "error", text: `语法错误，未保存：第 ${err.line} 行 ${err.message}` });
        return;
      }
      setSaving(true);
      try {
        const res = await api.writeServiceFile(serviceId, path, value, force ? null : etagRef.current);
        etagRef.current = res.etag;
        setOriginal(value);
        setMessage({ kind: "saved", at: new Date() });
        onSaved?.();
      } catch (err) {
        const e = err as ApiError;
        if (e.status === 409) {
          setMessage({ kind: "conflict" });
        } else if (e.status === 422 && typeof e.line === "number") {
          setServerError({ line: e.line, column: e.column ?? 1, message: e.message });
          setMessage({ kind: "error", text: e.message });
        } else {
          setMessage({ kind: "error", text: e.message || "保存失败" });
        }
      } finally {
        setSaving(false);
      }
    },
    [canWrite, dirty, saving, lang, serviceId, path, value, onSaved],
  );

  // Ace 的快捷键在挂载时绑定，用 ref 拿最新的 save
  const saveRef = useRef(save);
  saveRef.current = save;
  const handleSaveShortcut = useCallback(() => saveRef.current(), []);

  const reload = async () => {
    if (dirty && !window.confirm("将放弃当前未保存的修改，重新加载磁盘上的版本？")) return;
    await load();
    notification({ status: "success", title: "已重新加载" });
  };

  const fileName = path.split("/").pop() || path;

  return (
    <div className="terminal-dark flex min-h-0 flex-1 flex-col">
      {/* 头部 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2">
        <button
          type="button"
          onClick={onClose}
          className="-ml-1 rounded p-1 text-neutral-400 hover:bg-white/10 hover:text-neutral-200 md:hidden"
          aria-label="返回文件列表"
        >
          <RiArrowLeftLine className="size-4" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-medium text-neutral-100" title={path}>
            {fileName}
          </span>
          {dirty && <span className="size-2 shrink-0 rounded-full bg-yellow-400" title="未保存" />}
          <span className="hidden truncate text-xs text-neutral-500 lg:inline">/{path}</span>
          {lang && (
            <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[11px] uppercase text-neutral-400">{lang}</span>
          )}
          {!canWrite && <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-neutral-400">只读</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={reload}
            className="rounded p-1.5 text-neutral-400 hover:bg-white/10 hover:text-neutral-200"
            title="重新加载"
            aria-label="重新加载"
          >
            <RiRefreshLine className="size-4" />
          </button>
          {canWrite && (
            <>
              <button
                type="button"
                disabled={!dirty}
                onClick={() => setValue(original)}
                className="rounded p-1.5 text-neutral-400 hover:bg-white/10 hover:text-neutral-200 disabled:pointer-events-none disabled:opacity-30"
                title="撤销全部修改"
                aria-label="撤销全部修改"
              >
                <RiArrowGoBackLine className="size-4" />
              </button>
              <Button.Root size="xsmall" disabled={!dirty || saving} onClick={() => save()}>
                <Button.Icon as={saving ? RiLoader4Line : RiSave3Line} className={saving ? "animate-spin" : ""} />
                保存
              </Button.Root>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="hidden rounded p-1.5 text-neutral-400 hover:bg-white/10 hover:text-neutral-200 md:block"
            title="关闭"
            aria-label="关闭文件"
          >
            <RiCloseLine className="size-4" />
          </button>
        </div>
      </div>

      {/* 编辑区 */}
      <div className="relative min-h-0 flex-1 bg-[#282c34]">
        {status.kind === "loading" && (
          <div className="flex h-full items-center justify-center">
            <RiLoader4Line className="size-6 animate-spin text-neutral-500" />
          </div>
        )}
        {status.kind === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-neutral-400">
            <RiErrorWarningLine className="size-8 text-neutral-500" />
            {status.message}
          </div>
        )}
        {status.kind === "ready" && lang && (
          <AceConfigEditor
            lang={lang}
            value={value}
            onChange={setValue}
            onSave={handleSaveShortcut}
            error={shownError}
            readOnly={!canWrite}
            onLoad={(ed) => {
              editorRef.current = ed;
            }}
          />
        )}
      </div>

      {/* 状态栏 */}
      <div className="flex min-h-8 shrink-0 items-center gap-2 border-t border-white/10 bg-[#0a0a0a] px-3 py-1 text-xs">
        {status.kind !== "ready" ? (
          <span className="text-neutral-500">{status.kind === "loading" ? "加载中…" : ""}</span>
        ) : message?.kind === "conflict" ? (
          <span className="flex flex-wrap items-center gap-2 text-red-400">
            <RiErrorWarningLine className="size-3.5" />
            文件已被其他程序（如服务进程）修改
            <button type="button" className="rounded bg-white/10 px-2 py-0.5 text-neutral-200 hover:bg-white/20" onClick={load}>
              放弃我的修改并重新加载
            </button>
            <button type="button" className="rounded bg-white/10 px-2 py-0.5 text-neutral-200 hover:bg-white/20" onClick={() => save(true)}>
              仍然覆盖
            </button>
          </span>
        ) : shownError ? (
          <button
            type="button"
            className="truncate text-left text-red-400 hover:underline"
            onClick={() => {
              editorRef.current?.gotoLine(shownError.line, Math.max(0, shownError.column - 1), true);
              editorRef.current?.focus();
            }}
          >
            ✕ 第 {shownError.line} 行 第 {shownError.column} 列：{shownError.message}
          </button>
        ) : message?.kind === "error" ? (
          <span className="truncate text-red-400">✕ {message.text}</span>
        ) : message?.kind === "saved" && !dirty ? (
          <span className="flex items-center gap-1 text-green-400">
            <RiCheckLine className="size-3.5" />
            已保存 {message.at.toLocaleTimeString("zh-CN", { hour12: false })}
          </span>
        ) : (
          <span className="text-green-400/80">✓ 语法正确</span>
        )}
        <span className="flex-1" />
        {status.kind === "ready" && (
          <span className="hidden shrink-0 text-neutral-500 sm:inline">
            {canWrite ? "⌘/Ctrl+S 保存 · ⌘/Ctrl+F 搜索 · " : ""}
            {formatSize(new TextEncoder().encode(value).length)}
          </span>
        )}
      </div>
    </div>
  );
}
