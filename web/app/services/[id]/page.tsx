"use client";

import { notification } from "@/hooks/use-notification";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback, useRef, use } from "react";
import {
  RiDeleteBinLine,
  RiEditLine,
  RiLoader4Line,
  RiPlayCircleLine,
  RiRestartLine,
  RiStopCircleLine,
  RiTerminalBoxLine,
} from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as TabMenu from "@/components/ui/tab-menu-horizontal";
import { ServiceStatusBadge } from "@/components/ui/service-status";
import { PageLayout, PageContent, PageEmpty } from "@/components/layout/page-layout";
import { api, type ServiceDetail } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useServices } from "@/lib/services-context";
import { StopServicePopover } from "../components/stop-service-popover";
import { BrowserPanel } from "./components/browser-panel";
import { LogsPanel } from "./components/logs-panel";
import { TerminalPanel } from "./components/terminal-panel";
import { ConfigPanel } from "./components/config-panel";
import { DeleteServiceModal } from "../components/delete-service-modal";
import { ServiceFormModal } from "../components/service-form/service-form-modal";

export default function ServiceDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") as "logs" | "terminal" | "browser" | "config" | null;
  
  const { isAdmin } = useAuth();
  const { refreshServices } = useServices();
  const [service, setService] = useState<ServiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [operating, setOperating] = useState(false);
  const [activeTab, setActiveTab] = useState<"logs" | "terminal" | "browser" | "config">(
    initialTab || "terminal",
  );
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const defaultTabAppliedRef = useRef(false);

  // 加载服务详情
  const loadService = useCallback(async () => {
    try {
      setError(null);
      const data = await api.getService(params.id);
      setService(data);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setError(apiErr.message || "加载服务详情失败");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    defaultTabAppliedRef.current = false;
    loadService();

    pollingRef.current = setInterval(() => {
      loadService();
    }, 2000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [loadService]);

  useEffect(() => {
    if (!service || defaultTabAppliedRef.current) {
      return;
    }
    defaultTabAppliedRef.current = true;

    const hasBrowser = !!service.manifest.web?.enabled;
    const urlTab = searchParams.get("tab") as
      | "logs"
      | "terminal"
      | "browser"
      | "config"
      | null;

    if (urlTab === "browser" && !hasBrowser) {
      setActiveTab("terminal");
      return;
    }
    if (urlTab === "config" && !isAdmin) {
      setActiveTab(hasBrowser ? "browser" : "terminal");
      return;
    }
    if (urlTab) {
      setActiveTab(urlTab);
      return;
    }
    setActiveTab(hasBrowser ? "browser" : "terminal");
  }, [service, isAdmin, searchParams]);

  useEffect(() => {
    if (service && activeTab === "browser" && !service.manifest.web?.enabled) {
      setActiveTab("terminal");
    }
  }, [activeTab, service]);

  // 服务操作
  const handleAction = async (action: "start" | "stop" | "restart" | "shutdown" | "kill") => {
    setOperating(true);
    try {
      if (action === "start") await api.startService(params.id);
      else if (action === "stop") await api.stopService(params.id);
      else if (action === "shutdown") await api.shutdownService(params.id);
      else if (action === "kill") await api.killService(params.id);
      else await api.restartService(params.id);
      await loadService();
      // 同时刷新全局服务列表
      await refreshServices();
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      notification({
        status: "error",
        title: apiErr.message || `${action} 操作失败`,
      });
    } finally {
      setOperating(false);
    }
  };

  // 删除服务
  const handleDelete = async () => {
    setOperating(true);
    try {
      await api.deleteService(params.id);
      await refreshServices();
      router.push("/services");
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      notification({
        status: "error",
        title: apiErr.message || "删除服务失败",
      });
      setOperating(false);
    }
  };

  if (loading) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center py-40">
          <RiLoader4Line className="size-10 animate-spin text-text-soft-400" />
        </div>
      </PageLayout>
    );
  }

  if (error || !service) {
    return (
      <PageLayout>
        <PageContent>
          <PageEmpty
            icon={<RiTerminalBoxLine className="size-12" />}
            title="加载失败"
            description={error || "服务不存在"}
          />
        </PageContent>
      </PageLayout>
    );
  }

  const hasBrowserTab = service.manifest.web?.enabled;

  return (
    <PageLayout>
      {/* 与列表页 PageHeader 同一套边距与操作按钮位置 */}
      <div className="z-30 shrink-0 border-b border-stroke-soft-200 bg-bg-white-0">
        <div className="mx-auto max-w-7xl px-4 py-5 md:px-6 md:py-6">
          <div className="flex items-start justify-between gap-3 md:gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 sm:gap-3">
                {operating ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-stroke-soft-200 bg-bg-white-0 px-2 py-1 text-xs font-medium text-text-soft-400 shadow-regular-xs">
                    <RiLoader4Line className="size-3.5 animate-spin" />
                    处理中
                  </span>
                ) : (
                  <ServiceStatusBadge state={service.status.state} className="shrink-0" />
                )}
                <h1 className="truncate text-xl font-semibold tracking-tight text-text-strong-950 md:text-2xl">
                  {service.manifest.name}
                </h1>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {service.status.state !== "running" && (
                <Button.Root
                  size="small"
                  disabled={operating}
                  onClick={() => handleAction("start")}
                  aria-label="启动服务"
                >
                  <Button.Icon as={RiPlayCircleLine} />
                  <span className="hidden sm:inline">启动</span>
                </Button.Root>
              )}
              <Button.Root
                size="small"
                variant="neutral"
                mode="stroke"
                disabled={operating}
                onClick={() => handleAction("restart")}
                aria-label="重启服务"
              >
                <Button.Icon as={RiRestartLine} />
                <span className="hidden sm:inline">重启</span>
              </Button.Root>
              {service.status.state === "running" && (
                <StopServicePopover
                  onShutdown={() => handleAction("shutdown")}
                  onKill={() => handleAction("kill")}
                  align="end"
                >
                  <Button.Root
                    size="small"
                    variant="error"
                    mode="stroke"
                    disabled={operating}
                    aria-label="停止服务"
                  >
                    <Button.Icon as={RiStopCircleLine} />
                    <span className="hidden sm:inline">停止</span>
                  </Button.Root>
                </StopServicePopover>
              )}
              {isAdmin && (
                <>
                  <Button.Root
                    size="small"
                    variant="neutral"
                    mode="stroke"
                    disabled={operating}
                    onClick={() => setShowEditModal(true)}
                    aria-label="编辑服务"
                  >
                    <Button.Icon as={RiEditLine} />
                    <span className="hidden sm:inline">编辑</span>
                  </Button.Root>
                  <Button.Root
                    size="small"
                    variant="error"
                    mode="stroke"
                    disabled={operating}
                    onClick={() => setShowDeleteModal(true)}
                    aria-label="删除服务"
                  >
                    <Button.Icon as={RiDeleteBinLine} />
                    <span className="hidden sm:inline">删除</span>
                  </Button.Root>
                </>
              )}
            </div>
          </div>

          <TabMenu.Root
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "logs" | "terminal" | "browser" | "config")}
            className="mt-3 md:mt-4"
          >
            <TabMenu.List>
              {hasBrowserTab && (
                <TabMenu.Trigger value="browser">浏览器</TabMenu.Trigger>
              )}
              <TabMenu.Trigger value="terminal">终端</TabMenu.Trigger>
              <TabMenu.Trigger value="logs">日志</TabMenu.Trigger>
              {isAdmin && <TabMenu.Trigger value="config">配置</TabMenu.Trigger>}
            </TabMenu.List>
          </TabMenu.Root>
        </div>
      </div>

      <PageContent fillHeight={activeTab === "logs" || activeTab === "terminal" || activeTab === "browser"}>
        {activeTab === "logs" && <LogsPanel serviceId={params.id} serviceState={service.status.state} logPath={service.manifest.log_path} />}
        {activeTab === "terminal" && (
          <TerminalPanel
            serviceId={params.id}
            serviceState={service.status.state}
            ptyRows={service.manifest.pty_rows}
            terminalTui={service.manifest.terminal_tui}
          />
        )}
        {activeTab === "browser" && hasBrowserTab && (
          <BrowserPanel
            serviceId={params.id}
            title={service.manifest.web?.title}
          />
        )}
        {activeTab === "config" && isAdmin && <ConfigPanel manifest={service.manifest} onEdit={() => setShowEditModal(true)} />}
      </PageContent>

      {/* 删除确认弹窗 */}
      {showDeleteModal && (
        <DeleteServiceModal
          serviceName={service.manifest.name}
          onClose={() => setShowDeleteModal(false)}
          onConfirm={handleDelete}
        />
      )}

      {/* 编辑弹窗 */}
      <ServiceFormModal
        open={showEditModal}
        manifest={service.manifest}
        onClose={() => setShowEditModal(false)}
        onSuccess={async () => {
          setShowEditModal(false);
          await loadService();
          await refreshServices();
        }}
      />
    </PageLayout>
  );
}
