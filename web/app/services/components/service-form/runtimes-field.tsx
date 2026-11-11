"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RiArrowDownLine, RiArrowUpLine, RiCloseLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import { api, type Runtime } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toolLabel } from "@/app/runtimes/tool-meta";
import type { ServiceFormData } from "./types";

interface FieldProps {
  data: ServiceFormData;
  setField: <K extends keyof ServiceFormData>(field: K, value: ServiceFormData[K]) => void;
}

/**
 * 运行环境多选：按工具分组，每个工具至多选一个（单选切换），已选项按顺序决定 PATH 优先级
 */
export function RuntimesField({ data, setField }: FieldProps) {
  const { isAdmin } = useAuth();
  const [runtimes, setRuntimes] = useState<Runtime[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listRuntimes()
      .then(setRuntimes)
      .catch((e: { message?: string }) => setError(e.message || "加载运行环境失败"));
  }, []);

  const byId = useMemo(() => new Map((runtimes ?? []).map((r) => [r.id, r])), [runtimes]);
  const groups = useMemo(() => {
    const m = new Map<string, Runtime[]>();
    for (const r of runtimes ?? []) {
      if (!m.has(r.tool)) m.set(r.tool, []);
      m.get(r.tool)!.push(r);
    }
    return Array.from(m.entries());
  }, [runtimes]);

  const selected = data.runtimes;

  const toggle = (rt: Runtime) => {
    if (selected.includes(rt.id)) {
      setField("runtimes", selected.filter((id) => id !== rt.id));
      return;
    }
    // 同一工具只保留一个：替换原位置，保持顺序
    const idx = selected.findIndex((id) => byId.get(id)?.tool === rt.tool);
    if (idx >= 0) {
      const next = [...selected];
      next[idx] = rt.id;
      setField("runtimes", next);
    } else {
      setField("runtimes", [...selected, rt.id]);
    }
  };

  const move = (i: number, d: -1 | 1) => {
    const next = [...selected];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setField("runtimes", next);
  };

  return (
    <FormDialog.Field
      label="运行环境"
      hint={
        error ? (
          error
        ) : isAdmin ? (
          <>
            可多选，每种工具一个；
            <Link href="/runtimes" className="underline" target="_blank">
              管理
            </Link>
          </>
        ) : (
          "可多选，每种工具一个"
        )
      }
    >
      {runtimes === null && !error ? (
        <div className="text-xs text-text-soft-400">加载中…</div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stroke-soft-200 px-3 py-2.5 text-xs text-text-sub-600">
          还没有可用的运行环境{isAdmin ? "，请先到「环境」页安装" : "，请联系管理员安装"}
        </div>
      ) : (
        <div className="space-y-2.5">
          {groups.map(([tool, items]) => (
            <div key={tool}>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-soft-400">
                {toolLabel(tool)}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {items.map((rt) => {
                  const on = selected.includes(rt.id);
                  return (
                    <button
                      key={rt.id}
                      type="button"
                      onClick={() => toggle(rt)}
                      title={`${rt.id} · ${rt.version}`}
                      className={`rounded-md border px-2.5 py-1 text-xs transition ${
                        on
                          ? "border-primary-base bg-primary-base text-static-white"
                          : "border-stroke-soft-200 text-text-sub-600 hover:bg-bg-weak-50"
                      }`}
                    >
                      {rt.name}
                      <span className={`ml-1 font-mono ${on ? "opacity-70" : "text-text-soft-400"}`}>
                        {rt.version.length > 14 ? rt.version.slice(0, 14) + "…" : rt.version}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {selected.length > 0 && (
            <div className="rounded-lg border border-stroke-soft-200 bg-bg-weak-50 p-2">
              <div className="mb-1 px-1 text-[11px] text-text-soft-400">
                已选（按顺序前置到 PATH，靠前优先）
              </div>
              <ol className="space-y-1">
                {selected.map((id, i) => {
                  const rt = byId.get(id);
                  return (
                    <li key={id} className="flex items-center gap-2 rounded-md bg-bg-white-0 px-2 py-1 text-xs">
                      <span className="w-4 text-right font-mono text-text-soft-400">{i + 1}</span>
                      <span className={`min-w-0 flex-1 truncate ${rt ? "text-text-strong-950" : "text-error-base"}`}>
                        {rt ? rt.name : `${id}（不存在，启动将失败）`}
                      </span>
                      <button type="button" className="text-text-soft-400 hover:text-text-sub-600 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="上移">
                        <RiArrowUpLine className="size-3.5" />
                      </button>
                      <button type="button" className="text-text-soft-400 hover:text-text-sub-600 disabled:opacity-30" disabled={i === selected.length - 1} onClick={() => move(i, 1)} aria-label="下移">
                        <RiArrowDownLine className="size-3.5" />
                      </button>
                      <button type="button" className="text-text-soft-400 hover:text-error-base" onClick={() => setField("runtimes", selected.filter((x) => x !== id))} aria-label="移除">
                        <RiCloseLine className="size-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      )}
    </FormDialog.Field>
  );
}
