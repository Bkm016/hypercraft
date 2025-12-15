"use client";

import { useState, useMemo, useEffect } from "react";
import {
  RiFolderLine,
  RiCheckLine,
  RiCloseLine,
  RiSearchLine,
} from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import * as Input from "@/components/ui/input";
import { api, type ServiceGroup } from "@/lib/api";
import { cn } from "@/utils/cn";
import { notification } from "@/hooks/use-notification";

interface GroupSelectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceId: string;
  currentGroup: string | null;
  groups: ServiceGroup[];
  onUpdate: () => void;
}

export function GroupSelectModal({
  open,
  onOpenChange,
  serviceId,
  currentGroup,
  groups,
  onUpdate,
}: GroupSelectModalProps) {
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(currentGroup);

  // 打开时重置状态
  useEffect(() => {
    if (open) {
      setSelectedGroup(currentGroup);
      setSearchQuery("");
    }
  }, [open, currentGroup]);

  const filteredGroups = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(query));
  }, [groups, searchQuery]);

  const currentGroupInfo = useMemo(() => {
    return groups.find((g) => g.id === currentGroup);
  }, [groups, currentGroup]);

  const handleSave = async () => {
    if (selectedGroup === currentGroup) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    try {
      await api.updateServiceGroup(serviceId, selectedGroup);
      onOpenChange(false);
      setTimeout(() => {
        notification({
          status: "success",
          title: selectedGroup ? "已分配到分组" : "已移出分组",
        });
        onUpdate();
      }, 200);
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

  const hasChanges = selectedGroup !== currentGroup;

  return (
    <FormDialog.Root open={open} onOpenChange={onOpenChange}>
      <FormDialog.Content>
        <div>
          <FormDialog.Header
            icon={RiFolderLine}
            title="选择分组"
            description={currentGroupInfo ? `当前: ${currentGroupInfo.name}` : "未分组"}
          />
          <FormDialog.Body noPadding className="flex flex-col">
            {/* 搜索框 */}
            {groups.length > 5 && (
              <div className="border-b border-stroke-soft-200 p-4">
                <Input.Root size="small">
                  <Input.Wrapper>
                    <Input.Icon as={RiSearchLine} />
                    <Input.Input
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
            <div className="flex-1 overflow-y-auto p-4">
              {/* 无分组选项 */}
              <button
                type="button"
                onClick={() => setSelectedGroup(null)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm transition-all cursor-pointer",
                  selectedGroup === null
                    ? "bg-primary-alpha-10 text-primary-base"
                    : "text-text-sub-600 hover:bg-bg-soft-200 hover:text-text-strong-950"
                )}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                    selectedGroup === null
                      ? "border-primary-base bg-primary-base"
                      : "border-stroke-soft-200"
                  )}
                >
                  {selectedGroup === null && (
                    <RiCheckLine className="size-3 text-white" />
                  )}
                </span>
                <span className="flex-1 text-left font-medium">无分组</span>
              </button>

              {/* 分隔线 */}
              {filteredGroups.length > 0 && (
                <div className="my-3 border-t border-stroke-soft-200" />
              )}

              {/* 分组列表 */}
              {filteredGroups.length > 0 ? (
                <div className="space-y-1">
                  {filteredGroups.map((group) => {
                    const isSelected = selectedGroup === group.id;
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => setSelectedGroup(group.id)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm transition-all cursor-pointer",
                          isSelected
                            ? "bg-primary-alpha-10 text-primary-base"
                            : "text-text-sub-600 hover:bg-bg-soft-200 hover:text-text-strong-950"
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                            isSelected
                              ? "border-primary-base bg-primary-base"
                              : "border-stroke-soft-200"
                          )}
                        >
                          {isSelected && (
                            <RiCheckLine className="size-3 text-white" />
                          )}
                        </span>
                        <span
                          className="size-3.5 shrink-0 rounded-full"
                          style={{ backgroundColor: group.color || "#9ca3af" }}
                        />
                        <span className="flex-1 text-left truncate font-medium">
                          {group.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="px-4 py-8 text-center text-sm text-text-soft-400">
                  {searchQuery ? (
                    <>没有找到分组 &quot;{searchQuery}&quot;</>
                  ) : (
                    <>暂无分组，请先创建分组</>
                  )}
                </div>
              )}
            </div>
          </FormDialog.Body>
          <FormDialog.Footer>
            <FormDialog.Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              取消
            </FormDialog.Button>
            <FormDialog.Button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              loading={saving}
            >
              保存
            </FormDialog.Button>
          </FormDialog.Footer>
        </div>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
