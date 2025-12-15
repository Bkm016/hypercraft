"use client";

import { notification } from "@/hooks/use-notification";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback, useRef, use } from "react";
import {
  RiDeleteBinLine,
  RiEditLine,
  RiLoader4Line,
  RiMoreLine,
  RiPlayCircleLine,
  RiStopCircleLine,
  RiTerminalBoxLine,
} from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as TabMenu from "@/components/ui/tab-menu-horizontal";
import * as Dropdown from "@/components/ui/dropdown";
import * as CompactButton from "@/components/ui/compact-button";
import { PageLayout, PageContent, PageEmpty } from "@/components/layout/page-layout";
import { api, type ServiceDetail } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useServices } from "@/lib/services-context";
import { StopServicePopover } from "../components/stop-service-popover";
import { LogsPanel } from "./components/logs-panel";
import { TerminalPanel } from "./components/terminal-panel";
import { ConfigPanel } from "./components/config-panel";
import { DeleteServiceModal } from "../components/delete-service-modal";
import { ServiceFormModal } from "../components/service-form/service-form-modal";

const stateConfig = {
  running: { label: "运行中", dot: "bg-success-base", text: "text-success-base" },
  stopped: { label: "已停止", dot: "bg-text-soft-400", text: "text-text-soft-400" },
  unknown: { label: "未知", dot: "bg-away-base", text: "text-away-base" },
} as const;

export default function ServiceDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") as "logs" | "terminal" | "config" | null;
  
  const { isAdmin } = useAuth();
  const { refreshServices } = useServices();
  const [service, setService] = useState<ServiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [operating, setOperating] = useState(false);
  const [activeTab, setActiveTab] = useState<"logs" | "terminal" | "config">(initialTab || "terminal");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

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
    loadService();
    
    // 启用 2 秒轮询以保持状态同步
    pollingRef.current = setInterval(() => {
      loadService();
    }, 2000);
    
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [loadService]);

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

  const state = stateConfig[service.status.state];

  return (
    <PageLayout>
      {/* 自定义 Header */}
      <div className="shrink-0 border-b border-stroke-soft-200 bg-bg-white-0">
        <div className="mx-auto max-w-7xl px-4 py-2 sm:px-6 sm:py-3">
          {/* 标题行 */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="flex items-center gap-1.5 border-2 rounded-lg border-stroke-soft-200 bg-bg-weak-50 px-1.5 py-0.5 sm:px-2 sm:py-1 shrink-0">
                {operating ? (
                  <RiLoader4Line className="size-3.5 sm:size-4 animate-spin text-text-soft-400" />
                ) : (
                  <span className={`size-1.5 sm:size-2 rounded-full ${state.dot}`} />
                )}
                <span className={`text-xs sm:text-sm font-medium ${operating ? "text-text-soft-400" : state.text}`}>
                  {operating ? "..." : state.label}
                </span>
              </div>
              <h1 className="text-base sm:text-xl font-semibold text-text-strong-950 truncate">{service.manifest.name}</h1>
            </div>

            {/* 桌面端按钮 */}
            <div className="hidden sm:flex items-center gap-2">
              {service.status.state === "running" ? (
                <StopServicePopover
                  onShutdown={() => handleAction("shutdown")}
                  onKill={() => handleAction("kill")}
                >
                  <Button.Root 
                    size="xsmall" 
                    variant="error" 
                    mode="stroke"
                    disabled={operating}
                  >
                    <Button.Icon as={RiStopCircleLine} />
                    停止
                  </Button.Root>
                </StopServicePopover>
              ) : (
                <Button.Root 
                  size="xsmall"
                  disabled={operating}
                  onClick={() => handleAction("start")}
                >
                  <Button.Icon as={RiPlayCircleLine} />
                  启动
                </Button.Root>
              )}
              {isAdmin && (
                <>
                  <div className="mx-1 h-6 w-px bg-stroke-soft-200" />
                  <Button.Root 
                    size="xsmall" 
                    variant="neutral" 
                    mode="stroke"
                    disabled={operating}
                    onClick={() => setShowEditModal(true)}
                  >
                    <Button.Icon as={RiEditLine} />
                    编辑
                  </Button.Root>
                  <Button.Root 
                    size="xsmall" 
                    variant="error" 
                    mode="stroke"
                    disabled={operating}
                    onClick={() => setShowDeleteModal(true)}
                  >
                    <Button.Icon as={RiDeleteBinLine} />
                    删除
                  </Button.Root>
                </>
              )}
            </div>

            {/* 移动端按钮 */}
            <div className="flex sm:hidden items-center gap-1">
              {service.status.state === "running" ? (
                <StopServicePopover
                  onShutdown={() => handleAction("shutdown")}
                  onKill={() => handleAction("kill")}
                >
                  <CompactButton.Root variant="ghost" disabled={operating}>
                    <CompactButton.Icon as={RiStopCircleLine} className="text-error-base" />
                  </CompactButton.Root>
                </StopServicePopover>
              ) : (
                <CompactButton.Root variant="ghost" disabled={operating} onClick={() => handleAction("start")}>
                  <CompactButton.Icon as={RiPlayCircleLine} className="text-success-base" />
                </CompactButton.Root>
              )}
              {isAdmin && (
                <Dropdown.Root>
                  <Dropdown.Trigger asChild>
                    <CompactButton.Root variant="ghost">
                      <CompactButton.Icon as={RiMoreLine} />
                    </CompactButton.Root>
                  </Dropdown.Trigger>
                  <Dropdown.Content align="end" className="w-32">
                    <Dropdown.Item onClick={() => setShowEditModal(true)}>
                      <Dropdown.ItemIcon as={RiEditLine} />
                      编辑
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => setShowDeleteModal(true)} className="text-error-base">
                      <Dropdown.ItemIcon as={RiDeleteBinLine} className="text-error-base" />
                      删除
                    </Dropdown.Item>
                  </Dropdown.Content>
                </Dropdown.Root>
              )}
            </div>
          </div>

          {/* Tab 导航 */}
          <TabMenu.Root value={activeTab} onValueChange={(v) => setActiveTab(v as "logs" | "terminal" | "config")} className="mt-3 sm:mt-4">
            <TabMenu.List>
              <TabMenu.Trigger value="terminal">终端</TabMenu.Trigger>
              <TabMenu.Trigger value="logs">日志</TabMenu.Trigger>
              {isAdmin && <TabMenu.Trigger value="config">配置</TabMenu.Trigger>}
            </TabMenu.List>
          </TabMenu.Root>
        </div>
      </div>

      <PageContent fillHeight={activeTab === "logs" || activeTab === "terminal"}>
        {activeTab === "logs" && <LogsPanel serviceId={params.id} serviceState={service.status.state} logPath={service.manifest.log_path} />}
        {activeTab === "terminal" && <TerminalPanel serviceId={params.id} />}
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
