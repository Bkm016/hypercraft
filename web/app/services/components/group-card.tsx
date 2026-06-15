"use client";

import { useState, useCallback, useMemo } from "react";
import { useTheme } from "next-themes";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { RiArrowDownSLine } from "@remixicon/react";
import * as Checkbox from "@/components/ui/checkbox";
import { SectionHeader } from "@/components/ui/section-header";
import { CountBadge } from "@/components/ui/count-badge";
import { type ServiceSummary, type ServiceGroup } from "@/lib/api";
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
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onToggleSelectAll: (ids: string[]) => void;
  isDraggable?: boolean;
  /** 跨组拖拽时本组是否为当前落点，由父组件统一判定后下发高亮 */
  dropActive?: boolean;
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
  dropActive = false,
}: GroupCardProps) {
  const groupKey = group?.id || "ungrouped";
  const [collapsed, setCollapsed] = useState(() => {
    const stored = getCollapsedState()[groupKey];
    if (stored !== undefined) return stored;
    const running = services.filter((s) => s.state === "running").length;
    return running === 0;
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

  const groupColor = group?.color || null;
  // 边框淡分组色：暗色背景会压暗低透明度颜色，故暗色模式提高浓度（亮 ~35% / 暗 ~60%）
  const { resolvedTheme } = useTheme();
  const accentBorder = groupColor ? `${groupColor}${resolvedTheme === "dark" ? "99" : "59"}` : null;
  const serviceIds = useMemo(() => services.map((s) => s.id), [services]);

  // 跨组拖拽落点：仅管理员可把服务拖入本组，data 携带目标分组 id
  const { setNodeRef: setDropRef } = useDroppable({
    id: `group-drop:${groupKey}`,
    data: { type: "group", groupId: group?.id ?? null },
    disabled: !isDraggable || !isAdmin,
  });

  return (
    <section
      ref={setDropRef}
      className={`overflow-hidden rounded-xl border bg-bg-white-0 shadow-regular-xs transition-colors ${
        dropActive ? "border-primary-base ring-2 ring-primary-alpha-10" : "border-stroke-soft-200"
      }`}
      // 内联描边色一定渲染，按主题取不同浓度；拖拽高亮时让位主色
      style={accentBorder && !dropActive ? { borderColor: accentBorder } : undefined}
    >
      <div
        role="button"
        tabIndex={0}
        className={`flex cursor-pointer select-none transition-colors hover:bg-bg-weak-50 ${collapsed ? "" : "border-b border-stroke-soft-200"}`}
        onClick={toggleCollapsed}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleCollapsed();
          }
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5 py-3 pl-3 pr-4 md:pl-4 md:pr-5">
          <div
            className="shrink-0"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Checkbox.Root
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={toggleAllInGroup}
            />
          </div>
          <SectionHeader className="min-w-0 flex-1">
            {group?.name || "未分组"}
          </SectionHeader>
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="flex items-center gap-1.5 rounded-md border border-stroke-soft-200 bg-bg-weak-50 px-2 py-1">
              {runningCount > 0 && (
                <span className="size-1.5 shrink-0 rounded-full bg-success-base" />
              )}
              <CountBadge value={runningCount} total={services.length} />
            </div>
            <RiArrowDownSLine
              className={`size-4 text-text-soft-400 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
            />
          </div>
        </div>
      </div>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: collapsed ? "0fr" : "1fr" }}
      >
        <div className="min-h-0 overflow-hidden">
          {services.length > 0 ? (
            <div className="divide-y divide-stroke-soft-200">
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
                    onToggleSelect={(shiftKey) => onToggleSelect(service.id, shiftKey)}
                    isDraggable={isDraggable}
                    compact
                  />
                ))}
              </SortableContext>
            </div>
          ) : (
            <p className="px-3 py-6 text-center text-sm text-text-soft-400 sm:px-4">
              暂无服务
            </p>
          )}
        </div>
      </div>
    </section>
  );
}