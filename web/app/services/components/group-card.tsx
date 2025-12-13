"use client";

import { useState, useCallback, useMemo } from "react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { RiArrowDownSLine, RiServerLine } from "@remixicon/react";
import * as Checkbox from "@/components/ui/checkbox";
import { type ServiceSummary, type ServiceGroup, type ProcessStats } from "@/lib/api";
import { ServiceCard } from "./service-card";

const COLLAPSED_STORAGE_KEY = "hypercraft-group-collapsed";

function getCollapsedState(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveCollapsedState(state: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

export interface GroupCardProps {
  group: ServiceGroup | null;
  services: ServiceSummary[];
  allTags: string[];
  allGroups: ServiceGroup[];
  onServiceAction: (id: string, action: "start" | "stop" | "restart" | "shutdown" | "kill") => Promise<void>;
  onRefresh: () => void;
  onDelete: (service: ServiceSummary) => void;
  onEdit: (service: ServiceSummary) => void;
  onDuplicate: (service: ServiceSummary) => void;
  operating: Set<string>;
  isAdmin: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[]) => void;
  isDraggable?: boolean;
  processStats?: Record<string, ProcessStats>;
}

export function GroupCard({
  group,
  services,
  allTags,
  allGroups,
  onServiceAction,
  onRefresh,
  onDelete,
  onEdit,
  onDuplicate,
  operating,
  isAdmin,
  selected,
  onToggleSelect,
  onToggleSelectAll,
  isDraggable = false,
  processStats = {},
}: GroupCardProps) {
  const groupKey = group?.id || "ungrouped";
  const [collapsed, setCollapsed] = useState(() => {
    return getCollapsedState()[groupKey] ?? false;
  });

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      const state = getCollapsedState();
      state[groupKey] = next;
      saveCollapsedState(state);
      return next;
    });
  }, [groupKey]);

  const runningCount = services.filter((s) => s.state === "running").length;
  const allSelected = services.length > 0 && services.every((s) => selected.has(s.id));
  const someSelected = services.some((s) => selected.has(s.id));

  const toggleAllInGroup = () => {
    onToggleSelectAll(services.map((s) => s.id));
  };

  // 分组颜色，未分组使用默认灰色
  const groupColor = group?.color || "#6b7280";

  // 服务 ID 列表，用于 SortableContext
  const serviceIds = useMemo(() => services.map((s) => s.id), [services]);

  return (
    <div className="rounded-xl border border-stroke-soft-200 bg-bg-white-0 overflow-hidden shadow-sm transition-all hover:shadow-md">
      {/* 分组标题 */}
      <div 
        className="flex items-center gap-2.5 px-3 py-2 bg-bg-weak-50 border-b border-stroke-soft-200 cursor-pointer select-none group/header hover:bg-bg-weak-100 transition-colors"
        onClick={toggleCollapsed}
      >
        {/* 颜色指示条 */}
        <div 
          className="w-1 h-4 rounded-full shrink-0"
          style={{ backgroundColor: groupColor }}
        />

        {/* 全选当前分组 */}
        <div onClick={(e) => e.stopPropagation()} className="flex items-center">
          <Checkbox.Root
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={toggleAllInGroup}
          />
        </div>
        
        {/* 分组名称 */}
        <span className="text-sm font-medium text-text-strong-950 truncate flex-1 mt-0.5">
          {group?.name || "未分组"}
        </span>
        
        {/* 统计信息 */}
        <div className="flex items-center gap-3 text-xs shrink-0">
          <div className="flex items-center gap-1.5" title="运行中">
            <span className="size-1.5 rounded-full bg-success-base" />
            <span className="text-text-sub-600 font-medium">{runningCount}/{services.length}</span>
          </div>
          
          {/* 折叠图标 */}
          <div className={`transition-transform duration-200 text-text-soft-400 group-hover/header:text-text-sub-600 ${collapsed ? '-rotate-90' : ''}`}>
            <RiArrowDownSLine className="size-5" />
          </div>
        </div>
      </div>

      {/* 服务列表 */}
      <div 
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: collapsed ? '0fr' : '1fr' }}
      >
        <div className="overflow-hidden">
          <div className="p-3 space-y-1.5 bg-bg-white-0">
            {services.length > 0 ? (
              <SortableContext items={serviceIds} strategy={verticalListSortingStrategy}>
                {services.map((service) => (
                  <ServiceCard
                    key={service.id}
                    service={service}
                    allTags={allTags}
                    allGroups={allGroups}
                    onAction={(action) => onServiceAction(service.id, action)}
                    onRefresh={onRefresh}
                    onDelete={() => onDelete(service)}
                    onEdit={() => onEdit(service)}
                    onDuplicate={() => onDuplicate(service)}
                    operating={operating.has(service.id)}
                    isAdmin={isAdmin}
                    selected={selected.has(service.id)}
                    onToggleSelect={() => onToggleSelect(service.id)}
                    isDraggable={isDraggable}
                    processStats={processStats[service.id]}
                  />
                ))}
              </SortableContext>
            ) : (
              <div className="text-center py-6 text-sm text-text-soft-400">
                <RiServerLine className="size-8 mx-auto mb-2 opacity-50" />
                暂无服务
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
