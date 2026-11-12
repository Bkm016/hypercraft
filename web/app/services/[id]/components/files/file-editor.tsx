"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Ace } from "ace-builds";
import {
  RiArrowGoBackLine,
  RiArrowLeftSLine,
  RiCheckboxCircleFill,
  RiCloseCircleFill,
  RiCloseLine,
  RiDownload2Line,
  RiErrorWarningLine,
  RiFileCodeLine,
  RiFileWarningLine,
  RiLoader4Line,
  RiLock2Line,
  RiRefreshLine,
  RiSave3Line,
} from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as Tooltip from "@/components/ui/tooltip";
import { notification } from "@/hooks/use-notification";
import { api, type ApiError, type TextEncoding } from "@/lib/api";
import { langOf, lintConfig, type LintError } from "./lint";
import { modeForPath, modeLabel } from "./ace-modes";
import { IconButton, StatusBar } from "./workspace-ui";

const AceConfigEditor = dynamic(() => import("./ace-editor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <RiLoader4Line className="size-5 animate-spin text-[var(--ws-muted)]" />
    </div>
  ),
});

export interface FileEditorProps {
  serviceId: string;
  path: string;
  canWrite: boolean;
  /** Ace 主题名 */
  aceTheme: string;
  onDirtyChange: (dirty: boolean) => void;
  onSaved?: () => void;
  onClose: () => void;
}

type Status =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  /** 二进制：提示可十六进制查看或下载 */
  | { kind: "binary"; message: string }
  /** 超过在线编辑上限 */
  | { kind: "too-large"; message: string }
  | { kind: "ready" };

type Message = { kind: "saved"; at: Date } | { kind: "conflict" } | { kind: "error"; text: string } | null;

const ENCODING_LABEL: Record<TextEncoding, string> = {
  "utf-8": "UTF-8",
  "utf-8-bom": "UTF-8 BOM",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
  gb18030: "GBK / GB18030",
  big5: "Big5",
  shift_jis: "Shift_JIS",
  "euc-kr": "EUC-KR",
  "windows-1252": "Latin-1",
};

/** 超过这么多字符自动软换行之外，也作为日志类文件的判断依据 */
const WRAP_EXTS = /\.(log|out|txt|md|csv)$/i;

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function FileEditor({ serviceId, path, canWrite, aceTheme, onDirtyChange, onSaved, onClose }: FileEditorProps) {
  // 语法校验只针对 YAML / JSON / TOML；其他文本照常打开编辑，只做高亮
  const lang = langOf(path);
  const [mode, setMode] = useState("text");
  const [encoding, setEncoding] = useState<TextEncoding>("utf-8");
  /** 十六进制只读视图（二进制文件） */
  const [hexView, setHexView] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [value, setValue] = useState("");
  const [original, setOriginal] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [serverError, setServerError] = useState<LintError | null>(null);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const etagRef = useRef<string | null>(null);
  const editorRef = useRef<Ace.Editor | null>(null);

  useEffect(() => {
    let alive = true;
    modeForPath(path).then((m) => alive && setMode(m));
    return () => {
      alive = false;
    };
  }, [path]);

  const load = useCallback(
    async (asHex = false) => {
      setStatus({ kind: "loading" });
      setMessage(null);
      setServerError(null);
      try {
        const file = await api.readServiceFile(serviceId, path, asHex ? "hex" : undefined);
        etagRef.current = file.etag;
        setEncoding(file.encoding ?? "utf-8");
        setHexView(!!file.binary);
        setValue(file.content);
        setOriginal(file.content);
        setStatus({ kind: "ready" });
      } catch (err) {
        const e = err as ApiError;
        if (e.code === "BinaryFile") setStatus({ kind: "binary", message: e.message });
        else if (e.code === "FileTooLarge") setStatus({ kind: "too-large", message: e.message });
        else setStatus({ kind: "error", message: e.message || "读取文件失败" });
      }
    },
    [serviceId, path],
  );

  useEffect(() => {
    load();
  }, [load]);

  const writable = canWrite && !hexView;

  const dirty = status.kind === "ready" && value !== original;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  // 小文件即时校验；大文件防抖，避免每次按键整体解析几 MB 的文本
  const [lintError, setLintError] = useState<LintError | null>(null);
  useEffect(() => {
    if (!lang || hexView || status.kind !== "ready") {
      setLintError(null);
      return;
    }
    if (value.length < 200_000) {
      setLintError(lintConfig(lang, value));
      return;
    }
    const t = setTimeout(() => setLintError(lintConfig(lang, value)), value.length < 2_000_000 ? 300 : 800);
    return () => clearTimeout(t);
  }, [lang, hexView, value, status.kind]);
  // 编辑后清掉上一次服务端返回的错误位置
  useEffect(() => {
    setServerError(null);
  }, [value]);
  const shownError = lintError ?? serverError;

  const save = useCallback(
    async (force = false) => {
      if (!writable || !dirty || saving) return;
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
        const res = await api.writeServiceFile(serviceId, path, value, force ? null : etagRef.current, encoding);
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
    [writable, dirty, saving, lang, serviceId, path, value, encoding, onSaved],
  );

  // Ace 的快捷键在挂载时绑定，用 ref 拿最新的 save
  const saveRef = useRef(save);
  saveRef.current = save;
  const handleSaveShortcut = useCallback(() => saveRef.current(), []);

  const reload = async () => {
    if (dirty && !window.confirm("将放弃当前未保存的修改，重新加载磁盘上的版本？")) return;
    await load(hexView);
    notification({ status: "success", title: "已重新加载" });
  };

  const gotoError = () => {
    if (!shownError) return;
    editorRef.current?.gotoLine(shownError.line, Math.max(0, shownError.column - 1), true);
    editorRef.current?.focus();
  };

  const fileName = path.split("/").pop() || path;
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--ws-bg)]">
      {/* 标题栏 */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--ws-border)] bg-[var(--ws-panel)] pl-2 pr-2 md:pl-4">
        <IconButton label="返回文件列表" onClick={onClose} className="md:hidden" icon={RiArrowLeftSLine} />
        <RiFileCodeLine className="hidden size-4 shrink-0 text-[var(--ws-code)] md:block" />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate text-sm font-medium text-[var(--ws-fg)]" title={`/${path}`}>
            {fileName}
          </span>
          {dirty && (
            <span className="size-1.5 shrink-0 translate-y-[-2px] rounded-full bg-[var(--ws-accent)]" title="未保存" />
          )}
          {dir && <span className="hidden truncate text-xs text-[var(--ws-muted)] lg:inline">/{dir}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {(!canWrite || hexView) && status.kind === "ready" && (
            <span className="mr-1 inline-flex items-center gap-1 rounded-md bg-[var(--ws-hover)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--ws-sub)]">
              <RiLock2Line className="size-3" />
              {hexView ? "十六进制 · 只读" : "只读"}
            </span>
          )}
          <IconButton label="从磁盘重新加载" onClick={reload} icon={RiRefreshLine} />
          <IconButton
            label="下载"
            onClick={() =>
              api.downloadServiceFile(serviceId, path).catch((e: ApiError) =>
                notification({ status: "error", title: e.message || "下载失败" }),
              )
            }
            icon={RiDownload2Line}
          />
          {writable && (
            <>
              <IconButton
                label="撤销全部修改"
                onClick={() => setValue(original)}
                disabled={!dirty}
                icon={RiArrowGoBackLine}
              />
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    type="button"
                    disabled={!dirty || saving}
                    onClick={() => save()}
                    className="ml-1 inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--ws-accent)] px-2.5 text-xs font-medium text-[var(--ws-on-accent)] shadow-regular-xs transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
                  >
                    {saving ? <RiLoader4Line className="size-3.5 animate-spin" /> : <RiSave3Line className="size-3.5" />}
                    保存
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Content>⌘ / Ctrl + S</Tooltip.Content>
              </Tooltip.Root>
            </>
          )}
          <IconButton label="关闭" onClick={onClose} className="hidden md:flex" icon={RiCloseLine} />
        </div>
      </div>

      {/* 编辑区 */}
      <div className="relative min-h-0 flex-1">
        {status.kind === "loading" && (
          <div className="flex h-full items-center justify-center">
            <RiLoader4Line className="size-5 animate-spin text-[var(--ws-muted)]" />
          </div>
        )}
        {status.kind === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <RiErrorWarningLine className="size-8 text-[var(--ws-muted)]" />
            <div className="text-sm text-[var(--ws-sub)]">{status.message}</div>
            <Button.Root size="xxsmall" variant="neutral" mode="stroke" onClick={() => load()}>
              重试
            </Button.Root>
          </div>
        )}
        {(status.kind === "binary" || status.kind === "too-large") && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <RiFileWarningLine className="size-8 text-[var(--ws-muted)]" />
            <div className="max-w-sm text-sm text-[var(--ws-sub)]">{status.message}</div>
            <div className="flex gap-2">
              {status.kind === "binary" && (
                <Button.Root size="xxsmall" variant="neutral" mode="stroke" onClick={() => load(true)}>
                  以十六进制查看
                </Button.Root>
              )}
              <Button.Root
                size="xxsmall"
                variant="neutral"
                mode="stroke"
                onClick={() =>
                  api.downloadServiceFile(serviceId, path).catch((e: ApiError) =>
                    notification({ status: "error", title: e.message || "下载失败" }),
                  )
                }
              >
                下载
              </Button.Root>
            </div>
          </div>
        )}
        {status.kind === "ready" && (
          <AceConfigEditor
            mode={hexView ? "text" : mode}
            wrap={!hexView && WRAP_EXTS.test(path)}
            theme={aceTheme}
            value={value}
            onChange={setValue}
            onSave={handleSaveShortcut}
            error={shownError}
            readOnly={!writable}
            onLoad={(ed) => {
              editorRef.current = ed;
            }}
            onCursorChange={(line, column) => setCursor({ line, column })}
          />
        )}
      </div>

      {/* 冲突提示条 */}
      {status.kind === "ready" && message?.kind === "conflict" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--ws-border)] bg-error-lighter px-4 py-2 text-xs text-error-base">
          <RiErrorWarningLine className="size-4 shrink-0" />
          <span className="flex-1">文件已被其他程序（例如服务进程）修改，保存会覆盖对方的改动。</span>
          <Button.Root size="xxsmall" variant="neutral" mode="stroke" onClick={() => load()}>
            放弃我的修改
          </Button.Root>
          <Button.Root size="xxsmall" variant="error" onClick={() => save(true)}>
            仍然覆盖
          </Button.Root>
        </div>
      )}

      {/* 状态栏 */}
      <StatusBar>
        {status.kind !== "ready" ? (
          <span>{status.kind === "loading" ? "加载中…" : ""}</span>
        ) : shownError ? (
          <button
            type="button"
            className="flex min-w-0 items-center gap-1.5 text-error-base hover:underline"
            onClick={gotoError}
          >
            <RiCloseCircleFill className="size-3.5 shrink-0" />
            <span className="truncate">
              第 {shownError.line} 行，第 {shownError.column} 列：
              {shownError.message.replace(/\s+at line \d+, column \d+:?[\s\S]*$/, "")}
            </span>
          </button>
        ) : message?.kind === "error" ? (
          <span className="flex min-w-0 items-center gap-1.5 text-error-base">
            <RiCloseCircleFill className="size-3.5 shrink-0" />
            <span className="truncate">{message.text}</span>
          </span>
        ) : message?.kind === "saved" && !dirty ? (
          <span className="flex items-center gap-1.5 text-success-base">
            <RiCheckboxCircleFill className="size-3.5" />
            已保存 {message.at.toLocaleTimeString("zh-CN", { hour12: false })}
          </span>
        ) : hexView ? (
          <span>二进制文件，仅供查看</span>
        ) : lang ? (
          <span className="flex items-center gap-1.5">
            <RiCheckboxCircleFill className="size-3.5 text-success-base" />
            语法正确
          </span>
        ) : (
          <span>{writable ? "可编辑" : "只读"}</span>
        )}
        <span className="flex-1" />
        {status.kind === "ready" && (
          <span className="hidden shrink-0 items-center gap-3 tabular-nums sm:flex">
            <span>
              行 {cursor.line}，列 {cursor.column}
            </span>
            <span>{hexView ? "Hex" : modeLabel(mode)}</span>
            {!hexView && <span>{ENCODING_LABEL[encoding] ?? encoding}</span>}
            {!hexView && <span>{formatSize(new TextEncoder().encode(value).length)}</span>}
          </span>
        )}
      </StatusBar>
    </div>
  );
}
