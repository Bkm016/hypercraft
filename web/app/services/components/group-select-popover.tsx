"use client";

import { useState, useRef, useMemo } from "react";
import {
  RiFolderLine,
  RiLoader4Line,
  RiCheckLine,
  RiCloseLine,
  RiSearchLine,
} from "@remixicon/react";
import * as Popover from "@/components/ui/popover";
import * as Input from "@/components/ui/input";
import { api, type ServiceGroup } from "@/lib/api";
import { notification } from "@/hooks/use-notification";
import { cn } from "@/utils/cn";

interface GroupSelectPopoverProps {
  serviceId: string;
  currentGroup: string | null;
  groups: ServiceGroup[];
  onUpdate: () => void;
  children: React.ReactNode;
}

export function GroupSelectPopover({
  serviceId,
  currentGroup,
  groups,
  onUpdate,
  children,
}: GroupSelectPopoverProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时聚焦搜索框
  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setSearchQuery("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  // 过滤分组列表
  const filteredGroups = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(query));
  }, [groups, searchQuery]);

  // 获取当前分组信息
  const currentGroupInfo = useMemo(() => {
    return groups.find((g) => g.id === currentGroup);
  }, [groups, currentGroup]);

  const handleSelect = async (groupId: string | null) => {
    if (groupId === currentGroup) {
      setOpen(false);
      return;
    }

    setSaving(true);
    try {
      await api.updateServiceGroup(serviceId, groupId);
      onUpdate();
      setOpen(false);
      notification({
        status: "success",
        title: groupId ? "已分配到分组" : "已移出分组",
      });
    } catch (err) {
      const apiErr = err as { message?: string };
      notification({
        status: "error",
        title: apiErr.message || "更新分组失败",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Content align="end" className="w-[260px] p-0" showArrow={false}>
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-stroke-soft-200 px-4 py-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary-alpha-10">
            <RiFolderLine className="size-4 text-primary-base" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-text-strong-950">选择分组</h3>
            <p className="text-xs text-text-sub-600">
              {currentGroupInfo ? `当前: ${currentGroupInfo.name}` : "未分组"}
            </p>
          </div>
        </div>

        {/* 搜索框 */}
        {groups.length > 5 && (
          <div className="border-b border-stroke-soft-200 p-3">
            <Input.Root size="small">
              <Input.Wrapper>
                <Input.Icon as={RiSearchLine} />
                <Input.Input
                  ref={inputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索分组..."
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
        )}

        {/* 分组列表 */}
        <div className="max-h-[280px] overflow-y-auto p-2">
          {/* 无分组选项 */}
          <button
            type="button"
            onClick={() => handleSelect(null)}
            disabled={saving}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all cursor-pointer",
              currentGroup === null
                ? "bg-primary-alpha-10 text-primary-base"
                : "text-text-sub-600 hover:bg-bg-soft-200 hover:text-text-strong-950"
            )}
          >
            <span
              className={cn(
                "flex size-3.5 shrink-0 items-center justify-center rounded-full border-2",
                currentGroup === null
                  ? "border-text-soft-400 bg-text-soft-400"
                  : "border-stroke-soft-200"
              )}
            />
            <span className="flex-1 text-left font-medium">无分组</span>
            {currentGroup === null && (
              <RiCheckLine className="size-4 shrink-0 text-primary-base" />
            )}
          </button>

          {/* 分隔线 */}
          {filteredGroups.length > 0 && (
            <div className="my-2 border-t border-stroke-soft-200" />
          )}

          {/* 分组列表 */}
          {filteredGroups.length > 0 ? (
            <div className="space-y-0.5">
              {filteredGroups.map((group) => {
                const isSelected = currentGroup === group.id;
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => handleSelect(group.id)}
                    disabled={saving}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all cursor-pointer",
                      isSelected
                        ? "bg-primary-alpha-10 text-primary-base"
                        : "text-text-sub-600 hover:bg-bg-soft-200 hover:text-text-strong-950"
                    )}
                  >
                    <span
                      className="size-3.5 shrink-0 rounded-full"
                      style={{ backgroundColor: group.color || "#9ca3af" }}
                    />
                    <span className="flex-1 text-left truncate font-medium">
                      {group.name}
                    </span>
                    {isSelected && (
                      <RiCheckLine className="size-4 shrink-0 text-primary-base" />
                    )}
                  </button>
                );
              })}
            </div>
          ) : searchQuery ? (
            <div className="py-6 text-center text-sm text-text-soft-400">
              没有找到分组 &quot;{searchQuery}&quot;
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-text-soft-400">
              暂无分组，请先创建分组
            </div>
          )}
        </div>

        {/* Loading overlay */}
        {saving && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-bg-white-0/80">
            <RiLoader4Line className="size-5 animate-spin text-primary-base" />
          </div>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}
