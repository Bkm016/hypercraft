"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RiAddLine,
  RiBrush2Line,
  RiDeleteBinLine,
  RiDownloadCloud2Line,
  RiEditLine,
  RiFolderAddLine,
  RiLoader4Line,
  RiSettings3Line,
  RiStackLine,
} from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as Badge from "@/components/ui/badge";
import * as CompactButton from "@/components/ui/compact-button";
import { PageLayout, PageHeader, PageContent, PageFooter, PageEmpty, PageCard } from "@/components/layout/page-layout";
import { api, type InstallTask, type Runtime } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { notification } from "@/hooks/use-notification";
import { formatBytes } from "@/lib/format";
import { InstallRuntimeModal } from "./components/install-runtime-modal";
import { RegisterJavaModal } from "./components/register-java-modal";
import { DownloadSettingsModal } from "./components/download-settings-modal";
import { RenameRuntimeModal } from "./components/rename-runtime-modal";
import { DeleteRuntimeModal } from "./components/delete-runtime-modal";
import { InstallTaskList } from "./components/install-task-list";
import { CleanupModal } from "./components/cleanup-modal";
import { toolLabel } from "./tool-meta";

const SOURCE_LABEL: Record<Runtime["source"], { label: string; color: "blue" | "purple" | "gray" }> = {
  managed: { label: "托管", color: "blue" },
  custom: { label: "自定义", color: "purple" },
  system: { label: "系统", color: "gray" },
};

const ACTIVE_STATES = new Set(["pending", "resolving", "downloading", "extracting"]);

/** 「更新到最新」使用的 spec：优先安装时记录的 spec，其次由版本推导 */
function updateSpec(rt: Runtime): string {
  if (rt.spec) return rt.spec;
  const v = rt.mise_version || rt.id;
  if (rt.tool === "java") {
    const m = v.match(/^(.*?-)(\d+)(?:[.u+].*)?$/);
    return m ? `${m[1]}${m[2]}` : v;
  }
  return v.split(".")[0] || "latest";
}

const errMsg = (e: unknown, fallback: string) => (e as { message?: string }).message || fallback;

export default function RuntimesPage() {
  const router = useRouter();
  const { isAdmin, isLoading: authLoading } = useAuth();
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [tasks, setTasks] = useState<InstallTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCleanup, setShowCleanup] = useState(false);
  const [renaming, setRenaming] = useState<Runtime | null>(null);
  const [deleting, setDeleting] = useState<Runtime | null>(null);
  const prevActive = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!authLoading && !isAdmin) router.replace("/");
  }, [authLoading, isAdmin, router]);

  const loadRuntimes = useCallback(async () => {
    try {
      setError(null);
      setRuntimes(await api.listRuntimes());
    } catch (err: unknown) {
      setError(errMsg(err, "加载运行环境失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const list = await api.listInstallTasks();
      setTasks(list);
      const nowActive = new Set<string>(list.filter((t) => ACTIVE_STATES.has(t.state)).map((t) => t.id));
      // 有任务从进行中变为结束时刷新列表并提示
      for (const id of prevActive.current) {
        if (!nowActive.has(id)) {
          const t = list.find((x) => x.id === id);
          if (t?.state === "done") {
            notification({ status: "success", title: t.message || `${t.runtime_id} 安装完成` });
          } else if (t?.state === "failed") {
            notification({ status: "error", title: `${t.runtime_id} 安装失败` });
          }
          loadRuntimes();
        }
      }
      prevActive.current = nowActive;
    } catch {
      /* 轮询失败忽略 */
    }
  }, [loadRuntimes]);

  useEffect(() => {
    if (isAdmin) {
      loadRuntimes();
      loadTasks();
    }
  }, [isAdmin, loadRuntimes, loadTasks]);

  const hasActive = tasks.some((t) => ACTIVE_STATES.has(t.state));
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(loadTasks, 1500);
    return () => clearInterval(timer);
  }, [hasActive, loadTasks]);

  const installedIds = useMemo(() => new Set(runtimes.map((r) => r.id)), [runtimes]);
  const groups = useMemo(() => {
    const m = new Map<string, Runtime[]>();
    for (const r of runtimes) {
      if (!m.has(r.tool)) m.set(r.tool, []);
      m.get(r.tool)!.push(r);
    }
    return Array.from(m.entries());
  }, [runtimes]);
  const totalSize = runtimes.reduce((n, r) => n + (r.size_bytes || 0), 0);

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await api.deleteRuntime(deleting.id);
      setDeleting(null);
      await loadRuntimes();
      notification({ status: "success", title: "运行环境已删除" });
    } catch (err: unknown) {
      notification({ status: "error", title: errMsg(err, "删除失败") });
    }
  };

  const handleUpdate = async (rt: Runtime) => {
    try {
      await api.installRuntime({ tool: rt.tool, spec: updateSpec(rt), id: rt.id });
      loadTasks();
    } catch (err: unknown) {
      notification({ status: "error", title: errMsg(err, "更新失败") });
    }
  };

  const taskAction = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      notification({ status: "success", title: ok });
    } catch (err: unknown) {
      notification({ status: "error", title: errMsg(err, "操作失败") });
    } finally {
      loadTasks();
    }
  };

  if (authLoading || !isAdmin) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center py-20">
          <RiLoader4Line className="size-8 animate-spin text-text-soft-400" />
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title="运行环境"
        description="安装 Java、Node.js、Python 等运行环境，创建服务时可同时选择多个"
        actions={
          <div className="flex items-center gap-2">
            <Button.Root size="small" variant="neutral" mode="stroke" onClick={() => setShowCleanup(true)}>
              <Button.Icon as={RiBrush2Line} />
              <span className="hidden sm:inline">清理</span>
            </Button.Root>
            <Button.Root size="small" variant="neutral" mode="stroke" onClick={() => setShowSettings(true)}>
              <Button.Icon as={RiSettings3Line} />
              <span className="hidden sm:inline">下载源</span>
            </Button.Root>
            <Button.Root size="small" variant="neutral" mode="stroke" onClick={() => setShowRegister(true)}>
              <Button.Icon as={RiFolderAddLine} />
              <span className="hidden sm:inline">登记 JDK</span>
            </Button.Root>
            <Button.Root size="small" onClick={() => setShowInstall(true)}>
              <Button.Icon as={RiAddLine} />
              <span className="hidden sm:inline">安装</span>
            </Button.Root>
          </div>
        }
      />

      <PageContent>
        <div className="space-y-4">
          {tasks.length > 0 && (
            <InstallTaskList
              tasks={tasks}
              onCancel={(t) => taskAction(() => api.cancelInstallTask(t.id), `已取消 ${t.runtime_id}`)}
              onDelete={(t) => taskAction(() => api.deleteInstallTask(t.id), "已删除任务记录")}
              onClearFinished={() =>
                taskAction(async () => {
                  const r = await api.clearInstallTasks();
                  return r;
                }, "已清理已结束的任务")
              }
            />
          )}

          {loading && runtimes.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <RiLoader4Line className="size-8 animate-spin text-text-soft-400" />
            </div>
          ) : error ? (
            <PageEmpty icon={<RiStackLine className="size-12" />} title="加载失败" description={error} />
          ) : runtimes.length === 0 ? (
            <PageEmpty
              icon={<RiStackLine className="size-12" />}
              title="还没有运行环境"
              description="点击「安装」从镜像源一键安装 Java、Node.js、Python 等"
            />
          ) : (
            groups.map(([tool, items]) => (
              <PageCard key={tool} title={`${toolLabel(tool)} · ${items.length}`} noPadding>
                <div className="divide-y divide-stroke-soft-200">
                  {items.map((rt) => {
                    const src = SOURCE_LABEL[rt.source];
                    return (
                      <div key={rt.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 md:px-5">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-bg-weak-50 font-mono text-sm font-semibold text-text-strong-950">
                          {rt.major || "?"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-text-strong-950">{rt.name}</span>
                            <Badge.Root size="small" variant="lighter" color={src.color}>
                              {src.label}
                            </Badge.Root>
                            {rt.image_type && (
                              <Badge.Root size="small" variant="stroke" color="gray">
                                {rt.image_type}
                              </Badge.Root>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs text-text-sub-600">
                            <span>{rt.id}</span>
                            <span>{rt.version}</span>
                            {rt.vendor && <span className="font-sans">{rt.vendor}</span>}
                            {rt.size_bytes ? <span>{formatBytes(rt.size_bytes)}</span> : null}
                          </div>
                          <div className="mt-0.5 truncate font-mono text-[11px] text-text-soft-400" title={rt.home}>
                            {rt.home}
                          </div>
                          {rt.used_by.length > 0 && (
                            <div className="mt-1 text-xs text-text-sub-600">
                              被 {rt.used_by.length} 个服务使用：<span className="font-mono">{rt.used_by.join(", ")}</span>
                            </div>
                          )}
                        </div>
                        {rt.source !== "system" && (
                          <div className="flex shrink-0 items-center gap-1 self-end sm:self-center">
                            {rt.source === "managed" && (
                              <CompactButton.Root variant="ghost" title={`更新到 ${updateSpec(rt)} 的最新版本`} onClick={() => handleUpdate(rt)}>
                                <CompactButton.Icon as={RiDownloadCloud2Line} />
                              </CompactButton.Root>
                            )}
                            <CompactButton.Root variant="ghost" title="重命名" onClick={() => setRenaming(rt)}>
                              <CompactButton.Icon as={RiEditLine} />
                            </CompactButton.Root>
                            <CompactButton.Root variant="ghost" title="删除" onClick={() => setDeleting(rt)}>
                              <CompactButton.Icon as={RiDeleteBinLine} />
                            </CompactButton.Root>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </PageCard>
            ))
          )}
        </div>
      </PageContent>

      <PageFooter>
        <span>
          共 {runtimes.length} 个运行环境{totalSize ? ` · ${formatBytes(totalSize)}` : ""}
        </span>
      </PageFooter>

      {showInstall && (
        <InstallRuntimeModal
          installedIds={installedIds}
          onClose={() => setShowInstall(false)}
          onStarted={() => {
            setShowInstall(false);
            loadTasks();
          }}
        />
      )}
      {showRegister && (
        <RegisterJavaModal
          onClose={() => setShowRegister(false)}
          onSuccess={() => {
            setShowRegister(false);
            loadRuntimes();
            notification({ status: "success", title: "已登记运行环境" });
          }}
        />
      )}
      {showSettings && <DownloadSettingsModal onClose={() => setShowSettings(false)} />}
      {showCleanup && (
        <CleanupModal
          onClose={() => setShowCleanup(false)}
          onDone={() => {
            setShowCleanup(false);
            loadTasks();
            loadRuntimes();
          }}
        />
      )}
      {renaming && (
        <RenameRuntimeModal
          runtime={renaming}
          onClose={() => setRenaming(null)}
          onSuccess={() => {
            setRenaming(null);
            loadRuntimes();
          }}
        />
      )}
      {deleting && <DeleteRuntimeModal runtime={deleting} onClose={() => setDeleting(null)} onConfirm={handleDelete} />}
    </PageLayout>
  );
}
