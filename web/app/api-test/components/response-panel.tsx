"use client";

import type { AgentFetchResult } from "../lib/agent-fetch";

export interface ResponsePanelProps {
  result: AgentFetchResult | null;
  streaming: boolean;
  streamBody: string;
}

export function ResponsePanel({
  result,
  streaming,
  streamBody,
}: ResponsePanelProps) {
  if (!result && !streaming) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-stroke-soft-200 bg-bg-weak-50/40 px-4 py-8 text-sm text-text-soft-400">
        发送请求后在此查看响应
      </div>
    );
  }

  const status = result?.status ?? 0;
  const ok = result?.ok ?? streaming;
  const elapsed = result?.elapsedMs;
  const contentType = result?.contentType || (streaming ? "text/event-stream" : "");
  const body = streaming ? streamBody : result?.body || "";

  return (
    <div className="overflow-hidden rounded-xl border border-stroke-soft-200 bg-bg-white-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-stroke-soft-200 bg-bg-weak-50/50 px-4 py-2.5">
        <span
          className={`font-mono text-sm font-semibold ${
            streaming
              ? "text-away-base"
              : ok
                ? "text-success-base"
                : "text-error-base"
          }`}
        >
          {streaming ? "STREAM" : status || "—"}
        </span>
        {result?.statusText && !streaming && (
          <span className="text-xs text-text-sub-600">{result.statusText}</span>
        )}
        {elapsed != null && !streaming && (
          <span className="text-xs text-text-soft-400">{elapsed} ms</span>
        )}
        {streaming && (
          <span className="text-xs text-text-soft-400">接收中…</span>
        )}
        {contentType && (
          <span className="ml-auto truncate font-mono text-[11px] text-text-soft-400">
            {contentType}
          </span>
        )}
      </div>
      <pre className="max-h-[min(480px,50vh)] overflow-auto p-4 font-mono text-xs leading-relaxed text-text-strong-950 whitespace-pre-wrap break-all">
        {body || (streaming ? "" : "（空响应）")}
      </pre>
    </div>
  );
}
