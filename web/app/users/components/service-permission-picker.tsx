"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import {
  RiSearchLine,
  RiCloseLine,
  RiCheckLine,
  RiCheckboxMultipleLine,
  RiCheckboxBlankLine,
  RiArrowDownSLine,
} from "@remixicon/react";
import * as Checkbox from "@/components/ui/checkbox";
import * as Input from "@/components/ui/input";
import * as Popover from "@/components/ui/popover";
import type { ServiceSummary, ServiceGroup } from "@/lib/api";
import { cn } from "@/utils/cn";

export interface ServicePermissionPickerProps {
  services: ServiceSummary[];
  groups: ServiceGroup[];
  selectedIds: Set<string>;
  onChange: (selectedIds: Set<string>) => void;
  disabled?: boolean;
}

export function ServicePermissionPicker({
  services,
  groups,
  selectedIds,
  onChange,
  disabled = false,
}: ServicePermissionPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 过滤服务列表
  const filteredServices = useMemo(() => {
    if (!searchQuery.trim()) return services;
    const query = searchQuery.toLowerCase();
    return services.filter(
      (svc) =>
        svc.name.toLowerCase().includes(query) ||
        svc.id.toLowerCase().includes(query)
    );
  }, [services, searchQuery]);

  // 按分组组织服务
  const groupedServices = useMemo(() => {
    const result: Map<string | null, ServiceSummary[]> = new Map();
    
    // 初始化分组
    for (const group of groups) {
      result.set(group.id, []);
    }
    result.set(null, []); // 未分组

    // 分配服务到分组
    for (const service of filteredServices) {
      const groupId = service.group || null;
      if (result.has(groupId)) {
        result.get(groupId)!.push(service);
      } else {
        // 服务的分组不存在，放入未分组
        result.get(null)!.push(service);
      }
    }

    return result;
  }, [filteredServices, groups]);

  // 获取已选中的服务详情
  const selectedServices = useMemo(() => {
    return services.filter((svc) => selectedIds.has(svc.id));
  }, [services, selectedIds]);

  // 切换服务选中状态
  const toggleService = (serviceId: string) => {
    const next = new Set(selectedIds);
    if (next.has(serviceId)) {
      next.delete(serviceId);
    } else {
      next.add(serviceId);
    }
    onChange(next);
  };

  // 移除服务
  const removeService = (serviceId: string) => {
    const next = new Set(selectedIds);
    next.delete(serviceId);
    onChange(next);
  };

  // 切换分组内所有服务
  const toggleGroup = (groupId: string | null) => {
    const groupServices = groupedServices.get(groupId) || [];
    const groupIds = groupServices.map((svc) => svc.id);
    const allSelected = groupIds.every((id) => selectedIds.has(id));

    const next = new Set(selectedIds);
    if (allSelected) {
      for (const id of groupIds) {
        next.delete(id);
      }
    } else {
      for (const id of groupIds) {
        next.add(id);
      }
    }
    onChange(next);
  };

  // 全选/取消全选
  const toggleAll = () => {
    const allFilteredIds = filteredServices.map((svc) => svc.id);
    const allSelected = allFilteredIds.every((id) => selectedIds.has(id));

    const next = new Set(selectedIds);
    if (allSelected) {
      for (const id of allFilteredIds) {
        next.delete(id);
      }
    } else {
      for (const id of allFilteredIds) {
        next.add(id);
      }
    }
    onChange(next);
  };

  // 清空所有选择
  const clearAll = () => {
    onChange(new Set());
  };

  // 切换分组折叠状态
  const toggleCollapse = (groupId: string | null) => {
    const key = groupId || "__ungrouped__";
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // 检查分组是否折叠
  const isCollapsed = (groupId: string | null) => {
    const key = groupId || "__ungrouped__";
    return collapsedGroups.has(key);
  };

  // 计算全选状态
  const allFilteredSelected =
    filteredServices.length > 0 &&
    filteredServices.every((svc) => selectedIds.has(svc.id));

  // 打开时聚焦搜索框
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // 渲染分组
  const renderGroup = (groupId: string | null, group: ServiceGroup | null) => {
    const groupServices = groupedServices.get(groupId) || [];
    if (groupServices.length === 0) return null;

    const groupName = group?.name || "未分组";
    const groupColor = group?.color || "#9ca3af";
    const collapsed = isCollapsed(groupId);
    const allSelected = groupServices.every((svc) => selectedIds.has(svc.id));
    const someSelected = groupServices.some((svc) => selectedIds.has(svc.id));

    return (
      <div key={groupId || "ungrouped"} className="mb-1">
        {/* 分组标题 */}
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-bg-weak-50 cursor-pointer select-none"
          onClick={() => toggleCollapse(groupId)}
        >
          <RiArrowDownSLine
            className={cn(
              "size-4 text-text-soft-400 transition-transform",
              collapsed && "-rotate-90"
            )}
          />
          <div
            className="size-2.5 rounded-full shrink-0"
            style={{ backgroundColor: groupColor }}
          />
          <span className="flex-1 text-xs font-medium text-text-sub-600 truncate">
            {groupName}
          </span>
          <span className="text-xs text-text-soft-400">
            {groupServices.filter((s) => selectedIds.has(s.id)).length}/{groupServices.length}
          </span>
          {/* 分组全选 */}
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox.Root
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={() => toggleGroup(groupId)}
            />
          </div>
        </div>

        {/* 分组内服务列表 */}
        {!collapsed && (
          <div className="ml-4 border-l border-stroke-soft-200 pl-2 space-y-0.5">
            {groupServices.map((svc) => (
              <ServiceItem
                key={svc.id}
                service={svc}
                selected={selectedIds.has(svc.id)}
                onToggle={() => toggleService(svc.id)}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* 已选服务标签显示 */}
      <div className="min-h-[42px] rounded-xl border border-stroke-soft-200 bg-bg-weak-50/30 p-2">
        {selectedServices.length === 0 ? (
          <p className="px-2 py-1 text-sm text-text-soft-400">未选择任何服务</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {selectedServices.map((svc) => (
              <ServiceTag
                key={svc.id}
                service={svc}
                group={groups.find((g) => g.id === svc.group)}
                onRemove={() => removeService(svc.id)}
                disabled={disabled}
              />
            ))}
          </div>
        )}
      </div>

      {/* 添加/编辑按钮 */}
      <Popover.Root open={isOpen} onOpenChange={setIsOpen} modal={false}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-lg border border-stroke-soft-200 px-3 py-2 text-sm",
              "transition-colors hover:bg-bg-weak-50",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            <RiSearchLine className="size-4 text-text-soft-400" />
            <span className="text-text-sub-600">
              {selectedServices.length > 0
                ? `已选择 ${selectedServices.length} 个服务，点击编辑`
                : "点击选择服务"}
            </span>
          </button>
        </Popover.Trigger>

        <Popover.Content
          align="start"
          className="w-[380px] p-0"
          showArrow={false}
        >
          {/* 搜索框 */}
          <div className="border-b border-stroke-soft-200 p-3">
            <Input.Root size="small">
              <Input.Wrapper>
                <Input.Icon as={RiSearchLine} />
                <Input.Input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索服务名称或 ID..."
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="shrink-0 text-text-soft-400 hover:text-text-sub-600"
                  >
                    <RiCloseLine className="size-4" />
                  </button>
                )}
              </Input.Wrapper>
            </Input.Root>
          </div>

          {/* 工具栏 */}
          <div className="flex items-center justify-between border-b border-stroke-soft-200 px-3 py-2">
            <button
              type="button"
              onClick={toggleAll}
              className="flex items-center gap-1.5 text-xs text-text-sub-600 hover:text-text-strong-950"
            >
              {allFilteredSelected ? (
                <>
                  <RiCheckboxBlankLine className="size-4" />
                  <span>取消全选</span>
                </>
              ) : (
                <>
                  <RiCheckboxMultipleLine className="size-4" />
                  <span>全选{searchQuery ? "搜索结果" : ""}</span>
                </>
              )}
            </button>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-xs text-text-soft-400 hover:text-error-base"
              >
                清空选择
              </button>
            )}
          </div>

          {/* 服务列表（按分组） */}
          <div 
            className="max-h-72 overflow-y-auto overscroll-contain p-2"
            onWheel={(e) => e.stopPropagation()}
          >
            {filteredServices.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-soft-400">
                {services.length === 0 ? "暂无可用服务" : "没有匹配的服务"}
              </p>
            ) : (
              <>
                {/* 有分组的服务 */}
                {groups.map((group) => renderGroup(group.id, group))}
                {/* 未分组的服务 */}
                {renderGroup(null, null)}
              </>
            )}
          </div>

          {/* 底部统计 */}
          <div className="border-t border-stroke-soft-200 px-3 py-2">
            <p className="text-xs text-text-soft-400">
              已选择 {selectedIds.size} / {services.length} 个服务
            </p>
          </div>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}

// 服务标签组件
interface ServiceTagProps {
  service: ServiceSummary;
  group?: ServiceGroup;
  onRemove: () => void;
  disabled?: boolean;
}

function ServiceTag({ service, group, onRemove, disabled }: ServiceTagProps) {
  return (
    <div
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-md bg-bg-white-0 px-2 py-1",
        "border border-stroke-soft-200 text-xs",
        "transition-colors hover:border-stroke-sub-300"
      )}
    >
      {group && (
        <div
          className="size-2 rounded-full shrink-0"
          style={{ backgroundColor: group.color || "#9ca3af" }}
        />
      )}
      <span className="max-w-[120px] truncate text-text-strong-950">
        {service.name}
      </span>
      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 text-text-soft-400 transition-colors hover:text-error-base"
        >
          <RiCloseLine className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// 服务列表项组件
interface ServiceItemProps {
  service: ServiceSummary;
  selected: boolean;
  onToggle: () => void;
}

function ServiceItem({ service, selected, onToggle }: ServiceItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left",
        "transition-colors hover:bg-bg-weak-50",
        selected && "bg-primary-alpha-10"
      )}
    >
      <Checkbox.Root
        checked={selected}
        onCheckedChange={onToggle}
        onClick={(e) => e.stopPropagation()}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text-strong-950">{service.name}</p>
      </div>
      {selected && (
        <RiCheckLine className="size-4 shrink-0 text-primary-base" />
      )}
    </div>
  );
}
