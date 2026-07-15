export interface AgentFetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  contentType: string;
  elapsedMs: number;
  body: string;
  aborted?: boolean;
}

export interface AgentFetchOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  secret: string;
  /** JSON 请求体（create/update） */
  body?: string;
  signal?: AbortSignal;
  /** SSE：每读到一块追加文本 */
  onChunk?: (chunk: string) => void;
  timeoutMs?: number;
}

function prettyMaybeJson(text: string, contentType: string): string {
  const looksJson =
    contentType.includes("json") ||
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("[") && text.endsWith("]"));
  if (!looksJson) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** 用 API Key 直连后端（不走 JWT ApiClient） */
export async function agentFetch(
  opts: AgentFetchOptions
): Promise<AgentFetchResult> {
  const started = performance.now();
  // timeoutMs <= 0：不设超时（SSE follow）
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort);

  const timer =
    timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.secret}`,
      Accept: "*/*",
    };
    if (opts.body && opts.body.trim()) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(opts.url, {
      method: opts.method,
      headers,
      body: opts.body && opts.body.trim() ? opts.body : undefined,
      signal: controller.signal,
    });

    const contentType = res.headers.get("content-type") || "";

    // follow 流：边读边回调
    if (opts.onChunk && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let body = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        body += chunk;
        opts.onChunk(chunk);
      }
      body += decoder.decode();
      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        contentType,
        elapsedMs: Math.round(performance.now() - started),
        body,
      };
    }

    const raw = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      contentType,
      elapsedMs: Math.round(performance.now() - started),
      body: prettyMaybeJson(raw, contentType),
    };
  } catch (err: unknown) {
    const aborted =
      (err instanceof DOMException && err.name === "AbortError") ||
      opts.signal?.aborted ||
      controller.signal.aborted;
    if (aborted) {
      return {
        ok: false,
        status: 0,
        statusText: "aborted",
        contentType: "",
        elapsedMs: Math.round(performance.now() - started),
        body: "请求已取消",
        aborted: true,
      };
    }
    const message = err instanceof Error ? err.message : "请求失败";
    return {
      ok: false,
      status: 0,
      statusText: "error",
      contentType: "",
      elapsedMs: Math.round(performance.now() - started),
      body: message,
    };
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
