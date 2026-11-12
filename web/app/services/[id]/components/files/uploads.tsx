"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RiCheckboxCircleFill,
  RiCheckLine,
  RiCloseLine,
  RiErrorWarningFill,
  RiLoader4Line,
  RiPauseLine,
  RiPlayLine,
} from "@remixicon/react";
import { api, type ApiError } from "@/lib/api";
import { chunkedUpload, UploadAbortedError } from "./chunked-upload";

/** 上传 / 下载的单文件上限，与后端 MAX_TRANSFER_BYTES 一致 */
export const MAX_TRANSFER_BYTES = 512 * 1024 * 1024;

export interface UploadItem {
  id: number;
  dir: string;
  name: string;
  size: number;
  loaded: number;
  status: "queued" | "uploading" | "paused" | "done" | "error" | "skipped";
  error?: string;
  /** 是否从上次中断处继续 */
  resumed?: boolean;
}

export interface UploadsState {
  items: UploadItem[];
  enqueue: (dir: string, files: File[]) => void;
  /** 暂停全部（保留服务端会话，可继续） */
  pauseAll: () => void;
  /** 继续某一项（暂停或失败的） */
  resume: (id: number) => void;
  /** 取消某一项并清理服务端临时文件 */
  cancelItem: (id: number) => void;
  /** 取消全部进行中 / 排队 / 暂停的上传 */
  cancelAll: () => void;
  clear: () => void;
}

const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const isActive = (it: UploadItem) => it.status === "uploading" || it.status === "queued";

interface Job {
  file: File;
  overwrite: boolean;
  uploadId?: string;
  abort?: AbortController;
}

/**
 * 分片上传队列（单文件内 3 分片并发，文件之间顺序进行）。
 * 支持暂停 / 继续 / 取消；页面刷新后重新选择同一文件会自动从断点续传。
 * onUploaded 在每个文件完成后回调（用于刷新文件树）。
 */
export function useUploads(serviceId: string, onUploaded: (dir: string) => void): UploadsState {
  const [items, setItems] = useState<UploadItem[]>([]);
  const jobs = useRef(new Map<number, Job>());
  const queue = useRef<number[]>([]);
  const running = useRef(false);
  const currentId = useRef<number | null>(null);
  const nextId = useRef(1);
  const itemsRef = useRef<UploadItem[]>([]);
  itemsRef.current = items;
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
        const id = queue.current.shift()!;
        const job = jobs.current.get(id);
        const item = itemsRef.current.find((it) => it.id === id);
        if (!job || !item) continue;
        currentId.current = id;
        job.abort = new AbortController();
        patch(id, { status: "uploading", error: undefined });
        try {
          await chunkedUpload({
            serviceId,
            dir: item.dir,
            file: job.file,
            overwrite: job.overwrite,
            signal: job.abort.signal,
            onProgress: (loaded) => patch(id, { loaded }),
            onSession: (uploadId, resumed, receivedBytes) => {
              job.uploadId = uploadId;
              if (resumed && receivedBytes > 0) patch(id, { resumed: true, loaded: receivedBytes });
            },
          });
          patch(id, { status: "done", loaded: item.size });
          jobs.current.delete(id);
          onUploadedRef.current(item.dir);
        } catch (err) {
          if (err instanceof UploadAbortedError) {
            // 暂停或取消：状态已由触发方设置
            continue;
          }
          const e = err as ApiError;
          if (e.status === 409 && e.code === "AlreadyExists" && !e.message.includes("文件夹") && !job.overwrite) {
            if (window.confirm(`「/${joinPath(item.dir, item.name)}」已存在，是否覆盖？`)) {
              job.overwrite = true;
              queue.current.unshift(id);
              patch(id, { status: "queued" });
            } else {
              patch(id, { status: "skipped", error: "已跳过" });
              if (job.uploadId) api.abortChunkedUpload(serviceId, job.uploadId).catch(() => {});
              jobs.current.delete(id);
            }
            continue;
          }
          // 其他错误：保留会话，可点「继续」从断点重试
          patch(id, { status: "error", error: e.message || "上传失败" });
        }
      }
    } finally {
      running.current = false;
      currentId.current = null;
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
        if (file.size > MAX_TRANSFER_BYTES) {
          item.status = "error";
          item.error = "超过 512 MB";
        } else {
          jobs.current.set(item.id, { file, overwrite: false });
          queue.current.push(item.id);
        }
        added.push(item);
      }
      // 只保留最近的已结束记录，避免列表无限增长
      setItems((prev) => {
        const live = prev.filter((it) => isActive(it) || it.status === "paused" || it.status === "error");
        const ended = prev.filter((it) => it.status === "done" || it.status === "skipped").slice(-5);
        return [...live, ...ended, ...added];
      });
      setTimeout(run, 0);
    },
    [run],
  );

  const pauseAll = useCallback(() => {
    for (const it of itemsRef.current) {
      if (isActive(it)) patch(it.id, { status: "paused" });
    }
    queue.current = [];
    if (currentId.current != null) jobs.current.get(currentId.current)?.abort?.abort();
  }, [patch]);

  const resume = useCallback(
    (id: number) => {
      if (!jobs.current.has(id) || queue.current.includes(id)) return;
      patch(id, { status: "queued", error: undefined });
      queue.current.push(id);
      setTimeout(run, 0);
    },
    [patch, run],
  );

  const cancelItem = useCallback(
    (id: number) => {
      const job = jobs.current.get(id);
      queue.current = queue.current.filter((q) => q !== id);
      job?.abort?.abort();
      if (job?.uploadId) api.abortChunkedUpload(serviceId, job.uploadId).catch(() => {});
      jobs.current.delete(id);
      patch(id, { status: "skipped", error: "已取消" });
    },
    [serviceId, patch],
  );

  const cancelAll = useCallback(() => {
    for (const it of itemsRef.current) {
      if (isActive(it) || it.status === "paused" || it.status === "error") cancelItem(it.id);
    }
  }, [cancelItem]);

  const clear = useCallback(
    () => setItems((prev) => prev.filter((it) => isActive(it) || it.status === "paused")),
    [],
  );

  // 离开页面时提醒进行中的上传（会话保留 24 小时，重新选择同一文件可续传）
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (itemsRef.current.some(isActive)) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  return { items, enqueue, pauseAll, resume, cancelItem, cancelAll, clear };
}

function fmt(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 文件树底部的上传进度面板 */
export function UploadQueue({ state }: { state: UploadsState }) {
  if (!state.items.length) return null;
  const active = state.items.filter(isActive);
  const paused = state.items.filter((it) => it.status === "paused");
  const done = state.items.filter((it) => it.status === "done").length;
  const failed = state.items.filter((it) => it.status === "error").length;
  const tracked = state.items.filter((it) => it.status !== "skipped");
  const totalSize = tracked.reduce((n, it) => n + it.size, 0);
  const totalLoaded = tracked.reduce((n, it) => n + (it.status === "done" ? it.size : it.loaded), 0);
  const overall = totalSize ? Math.round((totalLoaded / totalSize) * 100) : 100;
  const btn =
    "rounded px-1.5 py-0.5 text-[var(--ws-muted)] transition-colors hover:bg-[var(--ws-hover)] hover:text-[var(--ws-fg)]";
  const iconBtn =
    "flex size-5 shrink-0 items-center justify-center rounded text-[var(--ws-muted)] transition-colors hover:bg-[var(--ws-hover)] hover:text-[var(--ws-fg)]";

  return (
    <div className="shrink-0 border-t border-[var(--ws-border)] bg-[var(--ws-panel)]">
      <div className="flex h-9 items-center gap-2 px-3 text-xs md:px-4">
        {active.length ? (
          <RiLoader4Line className="size-3.5 shrink-0 animate-spin text-[var(--ws-accent)]" />
        ) : paused.length ? (
          <RiPauseLine className="size-3.5 shrink-0 text-[var(--ws-muted)]" />
        ) : failed ? (
          <RiErrorWarningFill className="size-3.5 shrink-0 text-error-base" />
        ) : (
          <RiCheckboxCircleFill className="size-3.5 shrink-0 text-success-base" />
        )}
        <span className="font-medium text-[var(--ws-fg)]">
          {active.length
            ? `正在上传 ${active.length} 个文件`
            : paused.length
              ? `已暂停 ${paused.length} 个文件`
              : "上传结束"}
        </span>
        <span className="text-[var(--ws-muted)]">
          {active.length || paused.length ? `${overall}%` : `${done} 成功${failed ? ` · ${failed} 失败` : ""}`}
        </span>
        <span className="flex-1" />
        {active.length > 0 && (
          <button type="button" className={btn} onClick={state.pauseAll}>
            暂停
          </button>
        )}
        {active.length + paused.length + failed > 0 ? (
          <button type="button" className={btn} onClick={state.cancelAll}>
            全部取消
          </button>
        ) : (
          <button type="button" className={btn} onClick={state.clear}>
            清除
          </button>
        )}
      </div>
      {(active.length > 0 || paused.length > 0) && (
        <div className="mx-3 mb-1 h-0.5 overflow-hidden rounded-full bg-[var(--ws-hover)] md:mx-4">
          <div className="h-full rounded-full bg-[var(--ws-accent)] transition-[width] duration-300" style={{ width: `${overall}%` }} />
        </div>
      )}
      <ul className="max-h-36 overflow-auto pb-1.5">
        {state.items.map((it) => {
          const pct = it.size ? Math.min(100, Math.round((it.loaded / it.size) * 100)) : 100;
          const failedItem = it.status === "error";
          const resumable = (it.status === "paused" || failedItem) && it.error !== "超过 512 MB";
          const cancellable = isActive(it) || it.status === "paused" || failedItem;
          return (
            <li
              key={it.id}
              className="group flex h-6 items-center gap-2 px-3 text-xs md:px-4"
              title={`/${joinPath(it.dir, it.name)}${failedItem && it.error ? `\n${it.error}` : ""}`}
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center">
                {it.status === "uploading" ? (
                  <RiLoader4Line className="size-3.5 animate-spin text-[var(--ws-accent)]" />
                ) : it.status === "queued" ? (
                  <span className="size-1.5 rounded-full bg-[var(--ws-muted)]" />
                ) : it.status === "paused" ? (
                  <RiPauseLine className="size-3.5 text-[var(--ws-muted)]" />
                ) : it.status === "done" ? (
                  <RiCheckLine className="size-3.5 text-success-base" />
                ) : (
                  <RiCloseLine className={`size-3.5 ${failedItem ? "text-error-base" : "text-[var(--ws-muted)]"}`} />
                )}
              </span>
              <span className={`min-w-0 flex-1 truncate ${it.status === "skipped" ? "text-[var(--ws-muted)]" : "text-[var(--ws-sub)]"}`}>
                {it.name}
                {it.resumed && it.status !== "done" && <span className="ml-1.5 text-[var(--ws-muted)]">· 续传</span>}
              </span>
              <span
                className={`max-w-[45%] shrink-0 truncate tabular-nums ${failedItem ? "text-error-base" : "text-[var(--ws-muted)]"}`}
              >
                {failedItem || it.status === "skipped"
                  ? it.error
                  : it.status === "uploading" || it.status === "paused"
                    ? `${pct}% · ${fmt(it.loaded)} / ${fmt(it.size)}`
                    : it.status === "queued"
                      ? "等待中"
                      : fmt(it.size)}
              </span>
              {resumable && (
                <button type="button" className={iconBtn} title="继续（从断点续传）" aria-label="继续" onClick={() => state.resume(it.id)}>
                  <RiPlayLine className="size-3.5" />
                </button>
              )}
              {cancellable && (
                <button type="button" className={iconBtn} title="取消" aria-label="取消" onClick={() => state.cancelItem(it.id)}>
                  <RiCloseLine className="size-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
