"use client";

import { useMemo, useCallback, useState, useEffect } from "react";
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
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { RiServerLine } from "@remixicon/react";
import { api, type ServiceSummary, type ServiceGroup } from "@/lib/api";
import { useProcessStats } from "@/lib/process-stats-context";
import { GroupCard } from "./group-card";
import { ServiceCardDragOverlay } from "./service-card";
import { applyServiceOrder, applyGroupOrder, updateLocalServiceOrder } from "../local-order";

interface GroupedServicesViewProps {
  services: ServiceSummary[];
  groups: ServiceGroup[];
  onServiceAction: (id: string, action: "start" | "stop" | "restart" | "shutdown" | "kill") => Promise<void>;
  onRefresh: () => void | Promise<void>;
  onDelete: (service: ServiceSummary) => void;
  onEdit: (service: ServiceSummary) => void;
  onDuplicate: (service: ServiceSummary) => void;
  operating: Set<string>;
  isAdmin: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}

export function GroupedServicesView({
  services,
  groups,
  onServiceAction,
  onRefresh,
  onDelete,
  onEdit,
  onDuplicate,
  operating,
  isAdmin,
  selected,
  onToggleSelect,
}: GroupedServicesViewProps) {
  // 进程资源数据
  const { stats: processStats } = useProcessStats();

  // 本地服务状态，用于乐观更新
  // 对于普通用户，应用本地排序
  const [localServices, setLocalServices] = useState(() => applyServiceOrder(services, isAdmin));
  // 当前拖拽的服务
  const [activeService, setActiveService] = useState<ServiceSummary | null>(null);
  // 正在保存中，忽略外部更新
  const [isSaving, setIsSaving] = useState(false);
  
  useEffect(() => {
    // 保存中时不同步外部更新，避免轮询覆盖乐观更新
    if (!isSaving) {
      setLocalServices(applyServiceOrder(services, isAdmin));
    }
  }, [services, isSaving, isAdmin]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 100,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    localServices.forEach((s) => s.tags?.forEach((t) => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [localServices]);

  // 应用分组排序（普通用户使用本地排序）
  const sortedGroups = useMemo(() => applyGroupOrder(groups, isAdmin), [groups, isAdmin]);

  const groupedServices = useMemo(() => {
    const result: Map<string | null, ServiceSummary[]> = new Map();
    
    for (const group of sortedGroups) {
      result.set(group.id, []);
    }
    result.set(null, []);

    for (const service of localServices) {
      const groupId = service.group || null;
      if (!result.has(groupId)) {
        result.set(null, [...(result.get(null) || []), service]);
      } else {
        result.get(groupId)!.push(service);
      }
    }

    for (const [, svcList] of result) {
      svcList.sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    return result;
  }, [localServices, groups]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const service = localServices.find(s => s.id === active.id);
    setActiveService(service || null);
  }, [localServices]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveService(null);
    
    const { active, over } = event;
    
    if (!over || active.id === over.id) {
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;
    
    let activeGroup: string | null = null;
    let activeServices: ServiceSummary[] = [];
    
    for (const [groupId, svcList] of groupedServices) {
      const activeIndex = svcList.findIndex(s => s.id === activeId);
      if (activeIndex !== -1) {
        activeGroup = groupId;
        activeServices = [...svcList];
        break;
      }
    }
    
    const overIndex = activeServices.findIndex(s => s.id === overId);
    if (overIndex === -1) {
      return;
    }
    
    const activeIndex = activeServices.findIndex(s => s.id === activeId);
    const newServices = arrayMove(activeServices, activeIndex, overIndex);
    
    // 乐观更新本地状态
    setLocalServices(prev => {
      const updated = [...prev];
      for (let i = 0; i < newServices.length; i++) {
        const idx = updated.findIndex(s => s.id === newServices[i].id);
        if (idx !== -1) {
          updated[idx] = { ...updated[idx], order: i };
        }
      }
      return updated;
    });
    
    if (isAdmin) {
      // Admin 用户：保存到远程
      const reorderRequest = newServices.map((service, index) => ({
        id: service.id,
        group: activeGroup,
        order: index,
      }));
      
      // 开始保存，阻止轮询覆盖
      setIsSaving(true);
      
      try {
        await api.reorderServices({ services: reorderRequest });
        // 成功后刷新以同步服务器状态
        await onRefresh();
      } catch (error) {
        console.error("Failed to reorder services:", error);
        // 失败时也刷新以回滚
        await onRefresh();
      } finally {
        setIsSaving(false);
      }
    } else {
      // 普通用户：只保存到本地
      updateLocalServiceOrder(newServices);
    }
  }, [groupedServices, onRefresh, isAdmin]);

  const handleDragCancel = useCallback(() => {
    setActiveService(null);
  }, []);

  const handleToggleSelectAll = (ids: string[]) => {
    const allSelected = ids.every((id) => selected.has(id));
    if (allSelected) {
      ids.forEach((id) => onToggleSelect(id));
    } else {
      ids.filter((id) => !selected.has(id)).forEach((id) => onToggleSelect(id));
    }
  };

  const hasAnyServices = localServices.length > 0;

  const content = (
    <div className="space-y-4">
      {sortedGroups.map((group) => {
        const groupServices = groupedServices.get(group.id) || [];
        if (groupServices.length === 0) return null;
        return (
          <GroupCard
            key={group.id}
            group={group}
            services={groupServices}
            allTags={allTags}
            allGroups={groups}
            onServiceAction={onServiceAction}
            onRefresh={onRefresh}
            onDelete={onDelete}
            onEdit={onEdit}
            onDuplicate={onDuplicate}
            operating={operating}
            isAdmin={isAdmin}
            selected={selected}
            onToggleSelect={onToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
            isDraggable={true}
            processStats={processStats}
          />
        );
      })}

      {(groupedServices.get(null)?.length || 0) > 0 && (
        <GroupCard
          group={null}
          services={groupedServices.get(null) || []}
          allTags={allTags}
          allGroups={groups}
          onServiceAction={onServiceAction}
          onRefresh={onRefresh}
          onDelete={onDelete}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          operating={operating}
          isAdmin={isAdmin}
          selected={selected}
          onToggleSelect={onToggleSelect}
          onToggleSelectAll={handleToggleSelectAll}
          isDraggable={true}
          processStats={processStats}
        />
      )}

      {!hasAnyServices && (
        <div className="text-center py-16 text-text-soft-400">
          <RiServerLine className="size-12 mx-auto mb-3 opacity-50" />
          <p className="text-base font-medium text-text-sub-600">暂无服务</p>
          <p className="text-sm mt-1">点击右上角按钮创建第一个服务</p>
        </div>
      )}
    </div>
  );

  // 所有用户都支持拖拽排序（admin 保存到远程，普通用户保存到本地）
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {content}
      <DragOverlay dropAnimation={null}>
        {activeService ? (
          <ServiceCardDragOverlay service={activeService} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
