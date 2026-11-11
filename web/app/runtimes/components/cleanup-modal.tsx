"use client";

import { useEffect, useState } from "react";
import { RiBrush2Line, RiLoader4Line } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import * as Checkbox from "@/components/ui/checkbox";
import { api, type RuntimeStorage } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { notification } from "@/hooks/use-notification";

export interface CleanupModalProps {
  onClose: () => void;
  onDone: () => void;
}

export function CleanupModal({ onClose, onDone }: CleanupModalProps) {
  const [storage, setStorage] = useState<RuntimeStorage | null>(null);
  const [tasks, setTasks] = useState(true);
  const [cache, setCache] = useState(true);
  const [orphans, setOrphans] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getRuntimeStorage()
      .then((s) => {
        setStorage(s);
        setOrphans(s.orphans.length > 0);
      })
      .catch((e: { message?: string }) => setError(e.message || "读取占用失败"));
  }, []);

  const orphanBytes = storage?.orphans.reduce((n, o) => n + o.size_bytes, 0) ?? 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api.cleanupRuntimes({ tasks, cache, orphans });
      const freed = r.freed_cache_bytes + r.freed_orphan_bytes;
      notification({
        status: "success",
        title: `清理完成：释放 ${formatBytes(freed)}${r.removed_tasks ? `，删除 ${r.removed_tasks} 条任务记录` : ""}`,
      });
      onDone();
    } catch (err: unknown) {
      setError((err as { message?: string }).message || "清理失败");
    } finally {
      setLoading(false);
    }
  };

  const Row = ({
    checked,
    onChange,
    title,
    desc,
    disabled,
  }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    title: string;
    desc: React.ReactNode;
    disabled?: boolean;
  }) => (
    <label className={`flex items-start gap-3 rounded-lg border border-stroke-soft-200 px-3 py-2.5 ${disabled ? "opacity-50" : "cursor-pointer hover:bg-bg-weak-50"}`}>
      <Checkbox.Root checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text-strong-950">{title}</span>
        <span className="block text-xs text-text-sub-600">{desc}</span>
      </span>
    </label>
  );

  return (
    <FormDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <FormDialog.Content>
        <form onSubmit={handleSubmit}>
          <FormDialog.Header icon={RiBrush2Line} title="清理" description="释放运行环境占用的磁盘空间" />
          <FormDialog.Body className="space-y-3">
            {error && <FormDialog.Error message={error} />}
            {!storage && !error ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-text-sub-600">
                <RiLoader4Line className="size-5 animate-spin" />
                统计占用中…
              </div>
            ) : storage ? (
              <>
                <div className="text-xs text-text-sub-600">
                  已安装 {formatBytes(storage.installs_bytes)} · 下载缓存 {formatBytes(storage.cache_bytes)}
                </div>
                <Row checked={tasks} onChange={setTasks} title="已结束的安装任务" desc="删除已完成 / 失败 / 已取消的任务记录" />
                <Row
                  checked={cache}
                  onChange={setCache}
                  title="下载缓存"
                  desc={`mise 下载的压缩包与版本列表缓存（${formatBytes(storage.cache_bytes)}），不影响已安装的运行环境`}
                />
                <Row
                  checked={orphans}
                  onChange={setOrphans}
                  disabled={storage.orphans.length === 0}
                  title="未登记的安装"
                  desc={
                    storage.orphans.length === 0 ? (
                      "没有可清理的残留安装"
                    ) : (
                      <>
                        {storage.orphans.length} 个，共 {formatBytes(orphanBytes)}：
                        <span className="font-mono">
                          {storage.orphans.map((o) => `${o.tool}@${o.version}`).join(", ")}
                        </span>
                      </>
                    )
                  }
                />
              </>
            ) : null}
          </FormDialog.Body>
          <FormDialog.Footer>
            <FormDialog.Button type="button" variant="secondary" onClick={onClose}>
              取消
            </FormDialog.Button>
            <FormDialog.Button type="submit" loading={loading} disabled={!storage || !(tasks || cache || orphans)} icon={RiBrush2Line}>
              清理
            </FormDialog.Button>
          </FormDialog.Footer>
        </form>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
