/**
 * 分片上传与断点续传（客户端）。
 *
 * - 文件按 8 MiB 切片，每片计算 SHA-256（Web Crypto），服务端校验后才记为已收到；
 * - 3 个分片并发上传；网络错误 / 5xx 自动重试（指数退避），校验失败的分片重传；
 * - 指纹 = 目标路径 + 文件名 + 大小 + 修改时间：刷新页面、断网恢复后重新选择同一文件，
 *   服务端会找回未完成的会话，只上传缺失的分片；
 * - 暂停 = 中断当前请求并保留会话；取消 = 删除服务端会话与临时文件。
 */
import { api, type ApiError, type FileEntry } from "@/lib/api";

export const CHUNK_BYTES = 8 * 1024 * 1024;
const PARALLEL = 3;
const MAX_RETRIES = 5;

export class UploadAbortedError extends Error {
  constructor() {
    super("已暂停");
    this.name = "UploadAbortedError";
  }
}

export interface ChunkedUploadOptions {
  serviceId: string;
  dir: string;
  file: File;
  overwrite?: boolean;
  signal: AbortSignal;
  /** 已确认（服务端收到）的字节 + 正在传的字节 */
  onProgress: (loaded: number, total: number) => void;
  /** 会话创建 / 找回后回调，便于外部取消时清理 */
  onSession?: (uploadId: string, resumed: boolean, receivedBytes: number) => void;
}

export function fingerprintOf(dir: string, file: File) {
  return `${dir}/${file.name}|${file.size}|${file.lastModified}`;
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new UploadAbortedError());
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new UploadAbortedError());
      },
      { once: true },
    );
  });

function isRetryable(e: ApiError) {
  // 网络错误、限流、服务端错误、分片校验失败都可以重试；4xx 业务错误直接失败
  return !e.status || e.status === 408 || e.status === 429 || e.status >= 500 || e.code === "ChunkChecksumMismatch";
}

/**
 * 上传一个文件；完成后返回文件条目。
 * 抛出 UploadAbortedError 表示被暂停（会话保留，可再次调用续传）。
 * 抛出 status=409 / code=AlreadyExists 表示目标已存在（未带 overwrite）。
 */
export async function chunkedUpload(opts: ChunkedUploadOptions): Promise<FileEntry> {
  const { serviceId, dir, file } = opts;
  const outer = opts.signal;
  if (outer.aborted) throw new UploadAbortedError();
  // 内部控制器：外部暂停或任一分片彻底失败时，停止其余并发分片
  const inner = new AbortController();
  const onOuterAbort = () => inner.abort();
  outer.addEventListener("abort", onOuterAbort, { once: true });
  const signal = inner.signal;
  try {
    return await run();
  } catch (err) {
    if (outer.aborted) throw new UploadAbortedError();
    throw err;
  } finally {
    outer.removeEventListener("abort", onOuterAbort);
    inner.abort();
  }

  async function run(): Promise<FileEntry> {

  const session = await api.initChunkedUpload(serviceId, {
    dir,
    name: file.name,
    size: file.size,
    chunk_size: CHUNK_BYTES,
    overwrite: !!opts.overwrite,
    fingerprint: fingerprintOf(dir, file),
  });
  const { upload_id: uploadId, chunk_size: chunkSize, total_chunks: total } = session;
  const received = new Set(session.received);
  opts.onSession?.(uploadId, session.resumed, session.received_bytes);

  const chunkLen = (i: number) => (file.size === 0 ? 0 : Math.min(chunkSize, file.size - i * chunkSize));
  let confirmed = [...received].reduce((n, i) => n + chunkLen(i), 0);
  const inflight = new Map<number, number>();
  const report = () => {
    let busy = 0;
    for (const v of inflight.values()) busy += v;
    opts.onProgress(Math.min(file.size, confirmed + busy), file.size);
  };
  report();

  const pending: number[] = [];
  for (let i = 0; i < total; i++) if (!received.has(i)) pending.push(i);

  const uploadOne = async (index: number) => {
    const start = index * chunkSize;
    const blob = file.slice(start, start + chunkLen(index));
    const hash = await sha256Hex(await blob.arrayBuffer());
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw new UploadAbortedError();
      try {
        inflight.set(index, 0);
        await api.uploadChunk(serviceId, uploadId, index, blob, hash, {
          signal,
          onProgress: (loaded) => {
            inflight.set(index, loaded);
            report();
          },
        });
        inflight.delete(index);
        confirmed += chunkLen(index);
        report();
        return;
      } catch (err) {
        inflight.delete(index);
        report();
        const e = err as ApiError;
        if (signal.aborted || e.error === "Aborted") throw new UploadAbortedError();
        if (attempt >= MAX_RETRIES || !isRetryable(e)) throw err;
        await sleep(Math.min(16_000, 500 * 2 ** attempt), signal);
      }
    }
  };

  // 并发 worker；任一分片彻底失败即中止其余分片
  let cursor = 0;
  const workers = Array.from({ length: Math.min(PARALLEL, pending.length) }, async () => {
    while (cursor < pending.length && !signal.aborted) {
      const index = pending[cursor++];
      try {
        await uploadOne(index);
      } catch (err) {
        inner.abort();
        throw err;
      }
    }
  });
  const results = await Promise.allSettled(workers);
  const failed = results.find(
    (r): r is PromiseRejectedResult => r.status === "rejected" && !(r.reason instanceof UploadAbortedError),
  );
  if (failed) throw failed.reason;
  if (signal.aborted) throw new UploadAbortedError();
  return api.completeChunkedUpload(serviceId, uploadId, opts.overwrite);
  }
}
