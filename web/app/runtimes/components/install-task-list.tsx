"use client";

import {
  RiCheckLine,
  RiCloseCircleLine,
  RiCloseLine,
  RiDeleteBin6Line,
  RiForbidLine,
  RiLoader4Line,
} from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as CompactButton from "@/components/ui/compact-button";
import { PageCard } from "@/components/layout/page-layout";
import type { InstallTask } from "@/lib/api";
import { toolLabel } from "../tool-meta";

const STATE_LABEL: Record<InstallTask["state"], string> = {
  pending: "排队中",
  resolving: "解析版本",
  downloading: "下载中",
  extracting: "解压中",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const FINISHED = new Set(["done", "failed", "cancelled"]);

/** 下载来源主机；代理形式 https://proxy/https://origin/... 显示为 proxy → origin */
function hostOf(url?: string | null): string | null {
  if (!url) return null;
  try {
    const outer = new URL(url);
    const inner = url.slice(outer.origin.length + 1);
    if (/^https?:\/\//.test(inner)) return `${outer.host} → ${new URL(inner).host}`;
    return outer.host;
  } catch {
    return null;
  }
}

export interface InstallTaskListProps {
  tasks: InstallTask[];
  onCancel: (task: InstallTask) => void;
  onDelete: (task: InstallTask) => void;
  onClearFinished: () => void;
}

export function InstallTaskList({ tasks, onCancel, onDelete, onClearFinished }: InstallTaskListProps) {
  const finishedCount = tasks.filter((t) => FINISHED.has(t.state)).length;
  return (
    <PageCard
      title="安装任务"
      actions={
        finishedCount > 0 ? (
          <Button.Root size="xsmall" variant="neutral" mode="stroke" onClick={onClearFinished}>
            <Button.Icon as={RiDeleteBin6Line} />
            清理已结束（{finishedCount}）
          </Button.Root>
        ) : undefined
      }
      noPadding
    >
      <div className="max-h-96 divide-y divide-stroke-soft-200 overflow-auto">
        {tasks.map((t) => {
          const active = !FINISHED.has(t.state);
          const host = hostOf(t.source_url);
          return (
            <div key={t.id} className="px-4 py-3 md:px-5">
              <div className="flex items-center gap-2 text-sm">
                {active ? (
                  <RiLoader4Line className="size-4 shrink-0 animate-spin text-primary-base" />
                ) : t.state === "done" ? (
                  <RiCheckLine className="size-4 shrink-0 text-success-base" />
                ) : t.state === "cancelled" ? (
                  <RiForbidLine className="size-4 shrink-0 text-text-soft-400" />
                ) : (
                  <RiCloseCircleLine className="size-4 shrink-0 text-error-base" />
                )}
                <span className="shrink-0 text-xs text-text-soft-400">{toolLabel(t.tool)}</span>
                <span className="font-mono text-text-strong-950">{t.runtime_id}</span>
                <span className="shrink-0 text-text-sub-600">{STATE_LABEL[t.state]}</span>
                {host && <span className="min-w-0 truncate font-mono text-xs text-text-soft-400">{host}</span>}
                <span className="ml-auto shrink-0">
                  {active ? (
                    <CompactButton.Root variant="ghost" title="取消安装" onClick={() => onCancel(t)}>
                      <CompactButton.Icon as={RiCloseLine} />
                    </CompactButton.Root>
                  ) : (
                    <CompactButton.Root variant="ghost" title="删除记录" onClick={() => onDelete(t)}>
                      <CompactButton.Icon as={RiDeleteBin6Line} />
                    </CompactButton.Root>
                  )}
                </span>
              </div>
              {t.message && (
                <div
                  className={`mt-1 line-clamp-3 break-all text-xs ${t.state === "failed" ? "text-error-base" : "text-text-sub-600"}`}
                  title={t.message}
                >
                  {t.message}
                </div>
              )}
              {active && t.log.length > 0 && (
                <pre className="mt-2 max-h-28 overflow-auto rounded-md bg-bg-weak-50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-text-sub-600">
                  {t.log.slice(-6).join("\n")}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </PageCard>
  );
}
