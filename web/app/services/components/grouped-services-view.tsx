"use client";

import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { RiServerLine } from "@remixicon/react";
import { PageEmpty } from "@/components/layout/page-layout";
import { api, type ServiceSummary, type ServiceGroup } from "@/lib/api";
import { GroupCard } from "./group-card";
import { GroupMasonry, estimateGroupCardHeight, type GroupMasonryItem } from "./group-masonry";
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
  onRangeSelect: (ids: string[]) => void;
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
  onRangeSelect,
}: GroupedServicesViewProps) {
  // 本地服务状态，用于乐观更新
  // 对于普通用户，应用本地排序
  const [localServices, setLocalServices] = useState(() => applyServiceOrder(services, isAdmin));
  // 当前拖拽的服务
  const [activeService, setActiveService] = useState<ServiceSummary | null>(null);
  // 跨组拖拽时的目标分组 key（"ungrouped" 或 group.id），用于整组高亮
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  // 正在保存中，忽略外部更新
  const [isSaving, setIsSaving] = useState(false);
  // shift 多选：记录上次选择的服务 ID
  const lastSelectedRef = useRef<string | null>(null);

  useEffect(() => {
    // 保存中时不同步外部更新，避免轮询覆盖乐观更新
    if (!isSaving) {
      setLocalServices(applyServiceOrder(services, isAdmin));
    }
  }, [services, isSaving, isAdmin]);

  // 多容器碰撞检测：以指针落点为准，命中服务项时取该项（精确插入位置），否则取分组容器（含空白/标题区）
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    const collisions = pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(args);
    const serviceHit = collisions.find((c) => !String(c.id).startsWith("group-drop:"));
    return serviceHit ? [serviceHit] : collisions;
  }, []);

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

  // 按显示顺序展开的服务 ID 列表（用于 shift 多选）
  const displayOrderIds = useMemo(() => {
    const ids: string[] = [];
    for (const group of sortedGroups) {
      const groupServices = groupedServices.get(group.id) || [];
      groupServices.forEach((s) => ids.push(s.id));
    }
    const ungrouped = groupedServices.get(null) || [];
    ungrouped.forEach((s) => ids.push(s.id));
    return ids;
  }, [sortedGroups, groupedServices]);

  // 处理选择（支持 shift 多选）
  const handleToggleSelectWithShift = useCallback((id: string, shiftKey: boolean) => {
    if (shiftKey && lastSelectedRef.current && lastSelectedRef.current !== id) {
      const lastId = lastSelectedRef.current;
      const currentIndex = displayOrderIds.indexOf(id);
      const lastIndex = displayOrderIds.indexOf(lastId);
      if (currentIndex !== -1 && lastIndex !== -1) {
        const start = Math.min(currentIndex, lastIndex);
        const end = Math.max(currentIndex, lastIndex);
        const rangeIds = displayOrderIds.slice(start, end + 1);
        onRangeSelect(rangeIds);
        lastSelectedRef.current = id;
        return;
      }
    }
    onToggleSelect(id);
    lastSelectedRef.current = id;
  }, [displayOrderIds, onToggleSelect, onRangeSelect]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const service = localServices.find(s => s.id === active.id);
    setActiveService(service || null);
  }, [localServices]);

  // 拖拽过程中解析当前落点所属分组，仅管理员需要整组高亮
  const handleDragOver = useCallback((event: DragOverEvent) => {
    if (!isAdmin) return;
    const { over } = event;
    if (!over) {
      setDropTargetKey((prev) => (prev === null ? prev : null));
      return;
    }
    const overData = over.data.current as { type?: string; groupId?: string | null } | undefined;
    let key: string | null = null;
    if (overData?.type === "group") {
      key = overData.groupId ?? "ungrouped";
    } else {
      const overId = over.id as string;
      for (const [groupId, svcList] of groupedServices) {
        if (svcList.some((s) => s.id === overId)) {
          key = groupId ?? "ungrouped";
          break;
        }
      }
    }
    setDropTargetKey((prev) => (prev === key ? prev : key));
  }, [isAdmin, groupedServices]);

  // 远程保存排序结果并刷新，失败时回滚到服务器状态
  const persistReorder = useCallback(async (request: { id: string; group: string | null; order: number }[]) => {
    setIsSaving(true);
    try {
      await api.reorderServices({ services: request });
      await onRefresh();
    } catch (error) {
      console.error("Failed to reorder services:", error);
      await onRefresh();
    } finally {
      setIsSaving(false);
    }
  }, [onRefresh]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveService(null);
    setDropTargetKey(null);

    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;

    // 定位源分组
    let sourceGroup: string | null = null;
    let foundSource = false;
    for (const [groupId, svcList] of groupedServices) {
      if (svcList.some((s) => s.id === activeId)) {
        sourceGroup = groupId;
        foundSource = true;
        break;
      }
    }
    if (!foundSource) return;

    // 解析目标分组与插入位置：拖到分组容器落末尾，拖到服务上落其位置
    const overData = over.data.current as { type?: string; groupId?: string | null } | undefined;
    let targetGroup: string | null;
    let targetIndex: number;
    if (overData?.type === "group") {
      targetGroup = overData.groupId ?? null;
      targetIndex = (groupedServices.get(targetGroup) || []).length;
    } else {
      let resolved = false;
      targetGroup = null;
      targetIndex = 0;
      for (const [groupId, svcList] of groupedServices) {
        const idx = svcList.findIndex((s) => s.id === overId);
        if (idx !== -1) {
          targetGroup = groupId;
          targetIndex = idx;
          resolved = true;
          break;
        }
      }
      if (!resolved) return;
    }

    const sameGroup = sourceGroup === targetGroup;

    // 跨组移动属于分组管理，仅管理员可执行
    if (!sameGroup && !isAdmin) return;

    if (sameGroup) {
      const list = groupedServices.get(sourceGroup) || [];
      const oldIndex = list.findIndex((s) => s.id === activeId);
      if (oldIndex === -1 || oldIndex === targetIndex) return;

      const newList = arrayMove(list, oldIndex, targetIndex);

      setLocalServices((prev) => {
        const updated = [...prev];
        newList.forEach((svc, i) => {
          const idx = updated.findIndex((s) => s.id === svc.id);
          if (idx !== -1) updated[idx] = { ...updated[idx], order: i };
        });
        return updated;
      });

      if (isAdmin) {
        await persistReorder(newList.map((svc, i) => ({ id: svc.id, group: sourceGroup, order: i })));
      } else {
        updateLocalServiceOrder(newList);
      }
      return;
    }

    // 跨组移动：从源组移除，按落点插入目标组，两组 order 重排
    const moved = localServices.find((s) => s.id === activeId);
    if (!moved) return;

    const sourceList = (groupedServices.get(sourceGroup) || []).filter((s) => s.id !== activeId);
    const targetList = [...(groupedServices.get(targetGroup) || [])];
    const insertAt = Math.min(targetIndex, targetList.length);
    targetList.splice(insertAt, 0, { ...moved, group: targetGroup });

    setLocalServices((prev) => {
      const updated = prev.map((s) => ({ ...s }));
      const apply = (list: ServiceSummary[], groupId: string | null) => {
        list.forEach((svc, i) => {
          const idx = updated.findIndex((u) => u.id === svc.id);
          if (idx !== -1) updated[idx] = { ...updated[idx], group: groupId, order: i };
        });
      };
      apply(sourceList, sourceGroup);
      apply(targetList, targetGroup);
      return updated;
    });

    await persistReorder([
      ...sourceList.map((svc, i) => ({ id: svc.id, group: sourceGroup, order: i })),
      ...targetList.map((svc, i) => ({ id: svc.id, group: targetGroup, order: i })),
    ]);
  }, [groupedServices, localServices, onRefresh, isAdmin, persistReorder]);

  const handleDragCancel = useCallback(() => {
    setActiveService(null);
    setDropTargetKey(null);
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

  const masonryItems = useMemo((): GroupMasonryItem[] => {
    const list: GroupMasonryItem[] = [];
    const cardProps = {
      allTags,
      allGroups: groups,
      onServiceAction,
      onRefresh,
      onDelete,
      onEdit,
      onDuplicate,
      operating,
      isAdmin,
      selected,
      onToggleSelect: handleToggleSelectWithShift,
      onToggleSelectAll: handleToggleSelectAll,
      isDraggable: true as const,
    };

    for (const group of sortedGroups) {
      const groupServices = groupedServices.get(group.id) || [];
      if (groupServices.length === 0) continue;
      const running = groupServices.filter((s) => s.state === "running").length;
      const collapsedDefault = running === 0;
      list.push({
        key: group.id,
        estimateHeight: estimateGroupCardHeight(groupServices.length, collapsedDefault),
        node: (
          <GroupCard
            group={group}
            services={groupServices}
            dropActive={dropTargetKey === group.id}
            {...cardProps}
          />
        ),
      });
    }

    const ungrouped = groupedServices.get(null) || [];
    if (ungrouped.length > 0) {
      const running = ungrouped.filter((s) => s.state === "running").length;
      const collapsedDefault = running === 0;
      list.push({
        key: "ungrouped",
        estimateHeight: estimateGroupCardHeight(ungrouped.length, collapsedDefault),
        node: (
          <GroupCard
            group={null}
            services={ungrouped}
            dropActive={dropTargetKey === "ungrouped"}
            {...cardProps}
          />
        ),
      });
    }

    return list;
  }, [
    sortedGroups,
    groupedServices,
    allTags,
    groups,
    onServiceAction,
    onRefresh,
    onDelete,
    onEdit,
    onDuplicate,
    operating,
    isAdmin,
    selected,
    dropTargetKey,
    handleToggleSelectWithShift,
    handleToggleSelectAll,
  ]);

  const content = !hasAnyServices ? (
    <PageEmpty
      icon={<RiServerLine />}
      title="暂无服务"
      description="点击右上角按钮创建第一个服务"
    />
  ) : (
    <GroupMasonry items={masonryItems} />
  );

  // 所有用户都支持拖拽排序（admin 保存到远程，普通用户保存到本地）
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
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
