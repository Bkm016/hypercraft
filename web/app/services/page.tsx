"use client";

import { notification } from "@/hooks/use-notification";
import { useState, useMemo, useCallback } from "react";
import {
  RiAddLine,
  RiLoader4Line,
  RiFolderLine,
  RiPlayCircleLine,
  RiSearchLine,
  RiServerLine,
  RiStopCircleLine,
  RiCommandLine,
} from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as Input from "@/components/ui/input";
import * as CompactButton from "@/components/ui/compact-button";
import * as TabMenu from "@/components/ui/tab-menu-horizontal";
import { PageLayout, PageHeader, PageToolbar, PageContent, PageFooter, PageEmpty } from "@/components/layout/page-layout";
import { api, type ServiceSummary, type ServiceManifest } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useServices, useServicePolling } from "@/lib/services-context";
import { DeleteServiceModal } from "./components/delete-service-modal";
import { ServiceFormModal } from "./components/service-form/service-form-modal";
import { TagFilter } from "./components/tag-filter";
import { GroupManageModal } from "./components/group-manage-modal";
import { GroupedServicesView } from "./components/grouped-services-view";
import { StopServicePopover } from "./components/stop-service-popover";
import { BatchCommandModal } from "./components/batch-command-modal";

type StateFilter = "all" | "running" | "stopped";

const TAG_FILTER_STORAGE_KEY = "hypercraft-tag-filter";

function getStoredTags(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(TAG_FILTER_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveStoredTags(tags: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TAG_FILTER_STORAGE_KEY, JSON.stringify(tags));
  } catch {
    // ignore storage errors
  }
}

export default function ServicesPage() {
  const { isAdmin } = useAuth();
  const { services, groups, loading, error, refreshServices, refreshGroups, refreshAll } = useServices();
  
  // 启用 2 秒轮询以保持状态同步
  useServicePolling(2000);
  
  const [filter, setFilter] = useState<StateFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>(() => getStoredTags());

  const handleTagsChange = useCallback((tags: string[]) => {
    setSelectedTags(tags);
    saveStoredTags(tags);
  }, []);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showBatchCommandModal, setShowBatchCommandModal] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [operating, setOperating] = useState<Set<string>>(new Set());
  const [deletingService, setDeletingService] = useState<ServiceSummary | null>(null);
  const [editingService, setEditingService] = useState<ServiceManifest | null>(null);
  const [duplicatingService, setDuplicatingService] = useState<ServiceManifest | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // 收集所有标签
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    services.forEach((s) => s.tags?.forEach((t) => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [services]);

  // 启动/停止/重启服务
  const handleServiceAction = async (id: string, action: "start" | "stop" | "restart" | "shutdown" | "kill") => {
    setOperating((prev) => new Set(prev).add(id));
    try {
      if (action === "start") await api.startService(id);
      else if (action === "stop") await api.stopService(id);
      else if (action === "shutdown") await api.shutdownService(id);
      else if (action === "kill") await api.killService(id);
      else await api.restartService(id);
      await refreshServices();
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      notification({
        status: "error",
        title: apiErr.message || `${action} 操作失败`,
      });
    } finally {
      setOperating((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // 批量操作
  const handleBatchAction = async (action: "start" | "shutdown" | "kill") => {
    const ids = Array.from(selected);
    for (const id of ids) {
      await handleServiceAction(id, action);
    }
    setSelected(new Set());
  };

  // 删除服务
  const handleDeleteService = async (service: ServiceSummary) => {
    setOperating((prev) => new Set(prev).add(service.id));
    try {
      await api.deleteService(service.id);
      await refreshServices();
      setDeletingService(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(service.id);
        return next;
      });
      notification({ status: "success", title: "服务已删除" });
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      notification({
        status: "error",
        title: apiErr.message || "删除服务失败",
      });
    } finally {
      setOperating((prev) => {
        const next = new Set(prev);
        next.delete(service.id);
        return next;
      });
    }
  };

  // 编辑服务 - 先获取完整 manifest
  const handleEditService = async (service: ServiceSummary) => {
    try {
      const detail = await api.getService(service.id);
      setEditingService(detail.manifest);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      notification({
        status: "error",
        title: apiErr.message || "无法加载服务配置",
      });
    }
  };

  // 复制服务 - 先获取完整 manifest
  const handleDuplicateService = async (service: ServiceSummary) => {
    try {
      const detail = await api.getService(service.id);
      setDuplicatingService(detail.manifest);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      notification({
        status: "error",
        title: apiErr.message || "无法加载服务配置",
      });
    }
  };

  const filteredServices = useMemo(() => {
    return services.filter((svc) => {
      const matchesFilter = filter === "all" || svc.state === filter;
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        svc.name.toLowerCase().includes(q) ||
        svc.id.toLowerCase().includes(q);
      const matchesTags =
        selectedTags.length === 0 ||
        selectedTags.some((tag) => svc.tags?.includes(tag));
      return matchesFilter && matchesSearch && matchesTags;
    });
  }, [services, filter, search, selectedTags]);

  const stats = useMemo(() => ({
    running: services.filter((s) => s.state === "running").length,
    stopped: services.filter((s) => s.state === "stopped").length,
    total: services.length,
  }), [services]);

  const serviceNames = useMemo(() => {
    const map = new Map<string, string>();
    services.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [services]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleRangeSelect = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  return (
    <PageLayout>
      <PageHeader
        title="服务管理"
        description="查看和管理所有服务实例"
        actions={
          <div className="flex items-center gap-2">
            <Button.Root variant="neutral" size="small" onClick={() => setShowGroupModal(true)}>
              <Button.Icon as={RiFolderLine} />
              <span className="hidden sm:inline">分组管理</span>
            </Button.Root>
            {isAdmin && <Button.Root size="small" onClick={() => setShowCreateModal(true)}>
              <Button.Icon as={RiAddLine} />
              <span className="hidden sm:inline">新建服务</span>
            </Button.Root>}
          </div>
        }
      >
        <PageToolbar>
          {/* 筛选按钮 */}
          <div className="w-full overflow-x-auto md:flex-1">
            <TabMenu.Root value={filter} onValueChange={(v) => setFilter(v as StateFilter)}>
              <TabMenu.List className="min-w-full">
                <TabMenu.Trigger value="all">
                  全部 <span className="ml-1 opacity-60">{stats.total}</span>
                </TabMenu.Trigger>
                <TabMenu.Trigger value="running">
                  <span className="mr-1.5 size-1.5 rounded-full bg-success-base" />
                  运行中 <span className="ml-1 opacity-60">{stats.running}</span>
                </TabMenu.Trigger>
                <TabMenu.Trigger value="stopped">
                  <span className="mr-1.5 size-1.5 rounded-full bg-text-soft-400" />
                  已停止 <span className="ml-1 opacity-60">{stats.stopped}</span>
                </TabMenu.Trigger>
              </TabMenu.List>
            </TabMenu.Root>
          </div>

          {/* 搜索 + 标签筛选 + 批量操作 */}
          <div className="flex w-full items-center gap-2 md:w-auto md:gap-3 md:shrink-0">
            <Input.Root size="small" className="min-w-0 flex-1 md:w-52 md:flex-none">
              <Input.Wrapper>
                <Input.Icon as={RiSearchLine} />
                <Input.Input
                  type="text"
                  placeholder="搜索服务..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </Input.Wrapper>
            </Input.Root>

            {allTags.length > 0 && (
              <TagFilter
                allTags={allTags}
                selectedTags={selectedTags}
                onTagsChange={handleTagsChange}
              />
            )}

            {selected.size > 0 && (
              <div className="flex items-center gap-1 border-l border-stroke-soft-200 pl-2 md:gap-2 md:pl-3">
                <span className="hidden text-sm text-text-sub-600 sm:inline">已选 {selected.size}</span>
                <span className="text-xs text-text-sub-600 sm:hidden">{selected.size}</span>
                <CompactButton.Root 
                  variant="ghost"
                  onClick={() => handleBatchAction("start")}
                  className="text-success-base hover:bg-success-lighter hover:text-success-base"
                >
                  <CompactButton.Icon as={RiPlayCircleLine} />
                </CompactButton.Root>
                <StopServicePopover
                  onShutdown={() => handleBatchAction("shutdown")}
                  onKill={() => handleBatchAction("kill")}
                >
                  <CompactButton.Root
                    variant="ghost"
                    className="text-error-base hover:bg-error-lighter hover:text-error-base"
                  >
                    <CompactButton.Icon as={RiStopCircleLine} />
                  </CompactButton.Root>
                </StopServicePopover>
                <CompactButton.Root
                  variant="ghost"
                  onClick={() => setShowBatchCommandModal(true)}
                  className="text-information-base hover:bg-information-lighter hover:text-information-base"
                >
                  <CompactButton.Icon as={RiCommandLine} />
                </CompactButton.Root>
              </div>
            )}
          </div>
        </PageToolbar>
      </PageHeader>

      <PageContent>
        {loading && services.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <RiLoader4Line className="size-8 animate-spin text-text-soft-400" />
          </div>
        ) : error ? (
          <PageEmpty
            icon={<RiServerLine className="size-12" />}
            title="加载失败"
            description={error}
          />
        ) : (
          <GroupedServicesView
            services={filteredServices}
            groups={groups}
            operating={operating}
            isAdmin={isAdmin}
            onServiceAction={handleServiceAction}
            onRefresh={refreshAll}
            onDelete={setDeletingService}
            onEdit={handleEditService}
            onDuplicate={handleDuplicateService}
            selected={selected}
            onToggleSelect={handleToggleSelect}
            onRangeSelect={handleRangeSelect}
          />
        )}
      </PageContent>

      <PageFooter>
        <span>共 {filteredServices.length} 个服务</span>
        <span>
          <span className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-success-base" />
            {stats.running} 运行
          </span>
          <span className="mx-2">·</span>
          <span className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-text-soft-400" />
            {stats.stopped} 停止
          </span>
        </span>
      </PageFooter>

      {/* 删除确认弹窗 */}
      {deletingService && (
        <DeleteServiceModal
          serviceName={deletingService.name}
          onClose={() => setDeletingService(null)}
          onConfirm={() => handleDeleteService(deletingService)}
        />
      )}

      {/* 新建/编辑/复制服务弹窗 */}
      <ServiceFormModal
        open={showCreateModal || !!editingService || !!duplicatingService}
        onClose={() => {
          setShowCreateModal(false);
          setEditingService(null);
          setDuplicatingService(null);
        }}
        onSuccess={() => {
          setShowCreateModal(false);
          setEditingService(null);
          setDuplicatingService(null);
          refreshServices();
        }}
        manifest={editingService || undefined}
        duplicateFrom={duplicatingService || undefined}
      />

      {/* 分组管理弹窗 */}
      <GroupManageModal
        open={showGroupModal}
        onClose={() => setShowGroupModal(false)}
        groups={groups}
        onUpdate={refreshGroups}
        isAdmin={isAdmin}
      />

      {/* 批量发送指令弹窗 */}
      <BatchCommandModal
        open={showBatchCommandModal}
        onClose={() => setShowBatchCommandModal(false)}
        serviceIds={Array.from(selected)}
        serviceNames={serviceNames}
      />
    </PageLayout>
  );
}

