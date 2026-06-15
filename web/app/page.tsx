"use client";

import Link from "next/link";
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  RiArrowRightLine,
  RiCpuLine,
  RiDraggable,
  RiHardDriveLine,
  RiLoader4Line,
  RiRam2Line,
  RiStarFill,
} from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as CompactButton from "@/components/ui/compact-button";
import * as Tooltip from "@/components/ui/tooltip";
import { ServiceStatusDot, SERVICE_STATE_CONFIG } from "@/components/ui/service-status";
import { PageLayout, PageHeader, PageContent, PageCard } from "@/components/layout/page-layout";
import { ResourceCard } from "@/components/resource-card";
import { StatCard } from "@/components/stat-card";
import { api, type ServiceSummary, type SystemStats } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatBytes } from "@/lib/format";
import { getFavorites, removeFavorite, reorderFavorites } from "@/lib/favorites";

function SortableFavoriteItem({
  service,
  onRemove,
}: {
  service: ServiceSummary;
  onRemove: (id: string) => void;
}) {
  const state = SERVICE_STATE_CONFIG[service.state];
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: service.id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center justify-between px-3 py-3 transition-colors hover:bg-bg-weak-50 sm:px-4 ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-text-soft-400 hover:text-text-sub-600 -ml-1 touch-none"
        >
          <RiDraggable className="size-4" />
        </div>
        <ServiceStatusDot state={service.state} size="sm" />
        <Link
          href={`/services/${service.id}`}
          className="font-medium text-sm text-text-strong-950 truncate hover:underline"
        >
          {service.name}
        </Link>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-2">
        <span className={`text-xs ${state.text}`}>{state.label}</span>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <CompactButton.Root
              variant="ghost"
              size="medium"
              onClick={() => onRemove(service.id)}
            >
              <CompactButton.Icon as={RiStarFill} className="text-away-base" />
            </CompactButton.Root>
          </Tooltip.Trigger>
          <Tooltip.Content>取消收藏</Tooltip.Content>
        </Tooltip.Root>
      </div>
    </div>
  );
}

function FavoriteItemOverlay({ service }: { service: ServiceSummary }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-stroke-sub-300 bg-bg-white-0 shadow-regular-md cursor-grabbing">
      <RiDraggable className="size-4 text-text-soft-400" />
      <ServiceStatusDot state={service.state} size="sm" />
      <span className="text-sm font-medium text-text-strong-950 truncate">
        {service.name}
      </span>
    </div>
  );
}

export default function HomePage() {
  const { isAdmin, isAuthenticated, user } = useAuth();
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [activeService, setActiveService] = useState<ServiceSummary | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (isAuthenticated) {
      loadServices();
      loadSystemStats();
      setFavoriteIds(getFavorites());
      const interval = setInterval(loadSystemStats, 5000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);

  const loadServices = async () => {
    try {
      const data = await api.listServices();
      setServices(data);
    } catch {
      // 忽略错误
    } finally {
      setLoading(false);
    }
  };

  const loadSystemStats = async () => {
    try {
      const data = await api.getSystemStats();
      setSystemStats(data);
    } catch {
      // 忽略错误
    }
  };

  const stats = useMemo(() => ({
    total: services.length,
    running: services.filter((s) => s.state === "running").length,
    stopped: services.filter((s) => s.state === "stopped").length,
  }), [services]);

  // 按收藏顺序排列的服务列表
  const favoriteServices = useMemo(() => {
    const serviceMap = new Map(services.map(s => [s.id, s]));
    return favoriteIds
      .map(id => serviceMap.get(id))
      .filter((s): s is ServiceSummary => !!s);
  }, [services, favoriteIds]);

  const handleRemoveFavorite = useCallback((id: string) => {
    removeFavorite(id);
    setFavoriteIds(prev => prev.filter(fid => fid !== id));
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const svc = favoriteServices.find(s => s.id === event.active.id);
    setActiveService(svc || null);
  }, [favoriteServices]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveService(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setFavoriteIds(prev => {
      const oldIndex = prev.indexOf(active.id as string);
      const newIndex = prev.indexOf(over.id as string);
      const newOrder = arrayMove(prev, oldIndex, newIndex);
      reorderFavorites(newOrder);
      return newOrder;
    });
  }, []);

  return (
    <PageLayout>
      <PageHeader
        title="仪表盘"
        description={`欢迎回来，${user?.username == "__devtoken__" ? "管理员" :  user?.username ?? "用户"}`}
      />

      <PageContent>
        <div className="space-y-4 sm:space-y-6">
          {/* 统计卡片 */}
          <div className="grid grid-cols-1 divide-y divide-stroke-soft-200 overflow-hidden rounded-xl border border-stroke-soft-200 bg-bg-white-0 shadow-regular-xs sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <StatCard label="全部" value={stats.total} accentClass="bg-text-strong-950" />
            <StatCard
              label="运行中"
              value={stats.running}
              valueClass="text-success-base"
              indicator="bg-success-base"
              accentClass="bg-success-base"
            />
            <StatCard
              label="已停止"
              value={stats.stopped}
              valueClass="text-text-sub-600"
              indicator="bg-text-soft-400"
              accentClass="bg-text-soft-400"
            />
          </div>

          {/* 系统资源 */}
          {systemStats && (
            <PageCard title="系统资源">
              <div className="grid w-full grid-cols-1 items-stretch divide-y border-stroke-soft-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <ResourceCard
                  icon={RiCpuLine}
                  label="CPU"
                  value="实时采样"
                  usage={systemStats.cpu_usage}
                  color="primary"
                />
                <ResourceCard
                  icon={RiRam2Line}
                  label="内存"
                  value={`${formatBytes(systemStats.memory_used)} / ${formatBytes(systemStats.memory_total)}`}
                  usage={systemStats.memory_usage}
                  color="success"
                />
                <ResourceCard
                  icon={RiHardDriveLine}
                  label="磁盘"
                  value={`${formatBytes(systemStats.disk_used)} / ${formatBytes(systemStats.disk_total)}`}
                  usage={systemStats.disk_usage}
                  color="away"
                />
              </div>
            </PageCard>
          )}

          {/* 收藏的服务 */}
          <PageCard
            title="收藏的服务"
            actions={
              <Button.Root asChild size="xsmall" variant="neutral" mode="ghost">
                <Link href="/services">
                  查看全部
                  <Button.Icon as={RiArrowRightLine} />
                </Link>
              </Button.Root>
            }
          >
            {loading ? (
              <div className="flex items-center justify-center py-6 sm:py-8">
                <RiLoader4Line className="size-5 animate-spin text-text-soft-400" />
              </div>
            ) : favoriteServices.length > 0 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={favoriteIds} strategy={verticalListSortingStrategy}>
                  <div className="overflow-hidden rounded-lg border border-stroke-soft-200 divide-y divide-stroke-soft-200">
                    {favoriteServices.map((svc) => (
                      <SortableFavoriteItem
                        key={svc.id}
                        service={svc}
                        onRemove={handleRemoveFavorite}
                      />
                    ))}
                  </div>
                </SortableContext>
                <DragOverlay>
                  {activeService && <FavoriteItemOverlay service={activeService} />}
                </DragOverlay>
              </DndContext>
            ) : (
              <div className="py-6 sm:py-8 text-center text-sm text-text-soft-400">
                暂无收藏的服务，在服务列表中点击星标收藏
              </div>
            )}
          </PageCard>
        </div>
      </PageContent>
    </PageLayout>
  );
}
