"use client";

import { useCallback, useRef, useState } from "react";
import { RiCheckboxCircleFill, RiCheckLine, RiCloseLine, RiErrorWarningFill, RiLoader4Line } from "@remixicon/react";
import { api, type ApiError } from "@/lib/api";

/** 单文件上限，与后端一致 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface UploadItem {
  id: number;
  dir: string;
  name: string;
  size: number;
  loaded: number;
  status: "queued" | "uploading" | "done" | "error" | "skipped";
  error?: string;
}

export interface UploadsState {
  items: UploadItem[];
  enqueue: (dir: string, files: File[]) => void;
  cancel: () => void;
  clear: () => void;
}

const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/**
 * 顺序上传队列。onUploaded 在每个目录的上传完成后回调（用于刷新文件树）。
 * 同名文件逐个询问是否覆盖。
 */
export function useUploads(serviceId: string, onUploaded: (dir: string) => void): UploadsState {
  const [items, setItems] = useState<UploadItem[]>([]);
  const queue = useRef<{ item: UploadItem; file: File }[]>([]);
  const running = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  const patch = useCallback((id: number, p: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }, []);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (queue.current.length) {
        const { item, file } = queue.current.shift()!;
        const abort = new AbortController();
        abortRef.current = abort;
        patch(item.id, { status: "uploading" });
        const upload = (overwrite: boolean) =>
          api.uploadServiceFile(serviceId, item.dir, file, {
            overwrite,
            signal: abort.signal,
            onProgress: (loaded) => patch(item.id, { loaded }),
          });
        try {
          try {
            await upload(false);
          } catch (err) {
            const e = err as ApiError;
            if (e.status !== 409 || e.code !== "AlreadyExists" || e.message.includes("文件夹")) throw err;
            if (!window.confirm(`「/${joinPath(item.dir, item.name)}」已存在，是否覆盖？`)) {
              patch(item.id, { status: "skipped", error: "已跳过" });
              continue;
            }
            patch(item.id, { loaded: 0 });
            await upload(true);
          }
          patch(item.id, { status: "done", loaded: item.size });
          onUploadedRef.current(item.dir);
        } catch (err) {
          const e = err as ApiError;
          patch(item.id, { status: "error", error: e.message || "上传失败" });
          if (e.error === "Aborted") {
            // 取消：剩余排队项也一并取消
            for (const q of queue.current) patch(q.item.id, { status: "skipped", error: "已取消" });
            queue.current = [];
          }
        }
      }
    } finally {
      running.current = false;
      abortRef.current = null;
    }
  }, [serviceId, patch]);

  const enqueue = useCallback(
    (dir: string, files: File[]) => {
      const added: UploadItem[] = [];
      for (const file of files) {
        const item: UploadItem = {
          id: nextId.current++,
          dir,
          name: file.name,
          size: file.size,
          loaded: 0,
          status: "queued",
        };
        if (file.size > MAX_FILE_BYTES) {
          item.status = "error";
          item.error = "超过 25 MB";
        } else {
          queue.current.push({ item, file });
        }
        added.push(item);
      }
      // 只保留最近的已完成记录，避免列表无限增长
      setItems((prev) => [...prev.filter((it) => it.status === "uploading" || it.status === "queued").concat(prev.filter((it) => it.status !== "uploading" && it.status !== "queued").slice(-5)), ...added]);
      run();
    },
    [run],
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const clear = useCallback(() => setItems((prev) => prev.filter((it) => it.status === "uploading" || it.status === "queued")), []);

  return { items, enqueue, cancel, clear };
}

function fmt(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 文件树底部的上传进度面板 */
export function UploadQueue({ state }: { state: UploadsState }) {
  if (!state.items.length) return null;
  const active = state.items.filter((it) => it.status === "uploading" || it.status === "queued");
  const done = state.items.filter((it) => it.status === "done").length;
  const failed = state.items.filter((it) => it.status === "error").length;
  const totalSize = state.items.reduce((n, it) => n + it.size, 0);
  const totalLoaded = state.items.reduce((n, it) => n + (it.status === "done" ? it.size : it.loaded), 0);
  const overall = totalSize ? Math.round((totalLoaded / totalSize) * 100) : 100;

  return (
    <div className="shrink-0 border-t border-[var(--ws-border)] bg-[var(--ws-panel)]">
      <div className="flex h-9 items-center gap-2 px-3 text-xs md:px-4">
        {active.length ? (
          <RiLoader4Line className="size-3.5 shrink-0 animate-spin text-[var(--ws-accent)]" />
        ) : failed ? (
          <RiErrorWarningFill className="size-3.5 shrink-0 text-error-base" />
        ) : (
          <RiCheckboxCircleFill className="size-3.5 shrink-0 text-success-base" />
        )}
        <span className="font-medium text-[var(--ws-fg)]">
          {active.length ? `正在上传 ${active.length} 个文件` : "上传完成"}
        </span>
        <span className="text-[var(--ws-muted)]">
          {active.length ? `${overall}%` : `${done} 成功${failed ? ` · ${failed} 失败` : ""}`}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[var(--ws-muted)] transition-colors hover:bg-[var(--ws-hover)] hover:text-[var(--ws-fg)]"
          onClick={active.length ? state.cancel : state.clear}
        >
          {active.length ? "取消" : "清除"}
        </button>
      </div>
      {active.length > 0 && (
        <div className="mx-3 mb-1 h-0.5 overflow-hidden rounded-full bg-[var(--ws-hover)] md:mx-4">
          <div className="h-full rounded-full bg-[var(--ws-accent)] transition-[width] duration-300" style={{ width: `${overall}%` }} />
        </div>
      )}
      <ul className="max-h-32 overflow-auto pb-1.5">
        {state.items.map((it) => {
          const pct = it.size ? Math.min(100, Math.round((it.loaded / it.size) * 100)) : 100;
          const failedItem = it.status === "error";
          return (
            <li
              key={it.id}
              className="flex h-6 items-center gap-2 px-3 text-xs md:px-4"
              title={`/${joinPath(it.dir, it.name)}`}
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center">
                {it.status === "uploading" ? (
                  <RiLoader4Line className="size-3.5 animate-spin text-[var(--ws-accent)]" />
                ) : it.status === "queued" ? (
                  <span className="size-1.5 rounded-full bg-[var(--ws-muted)]" />
                ) : it.status === "done" ? (
                  <RiCheckLine className="size-3.5 text-success-base" />
                ) : (
                  <RiCloseLine className={`size-3.5 ${failedItem ? "text-error-base" : "text-[var(--ws-muted)]"}`} />
                )}
              </span>
              <span className={`min-w-0 flex-1 truncate ${it.status === "skipped" ? "text-[var(--ws-muted)]" : "text-[var(--ws-sub)]"}`}>
                {it.name}
              </span>
              <span
                className={`shrink-0 tabular-nums ${failedItem ? "text-error-base" : "text-[var(--ws-muted)]"}`}
              >
                {failedItem || it.status === "skipped"
                  ? it.error
                  : it.status === "uploading"
                    ? `${pct}%`
                    : it.status === "queued"
                      ? "等待中"
                      : fmt(it.size)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
