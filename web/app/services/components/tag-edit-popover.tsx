"use client";

import { useState, useRef, useMemo } from "react";
import {
  RiAddLine,
  RiPriceTag3Line,
  RiLoader4Line,
  RiSearchLine,
  RiCloseLine,
  RiCheckLine,
  RiArrowLeftLine,
} from "@remixicon/react";
import * as Popover from "@/components/ui/popover";
import * as Button from "@/components/ui/button";
import * as Input from "@/components/ui/input";
import * as Checkbox from "@/components/ui/checkbox";
import { api } from "@/lib/api";
import { notification } from "@/hooks/use-notification";
import { cn } from "@/utils/cn";
import {
  parseTag,
  serializeTag,
  DEFAULT_TAG_COLOR,
  TAG_PRESET_COLORS,
} from "./tag-utils";
import { TagColorPicker } from "./tag-color-picker";

interface TagEditPopoverProps {
  serviceId: string;
  tags: string[];
  allTags: string[];
  onUpdate: () => void;
  children: React.ReactNode;
}

// 内部使用的标签状态（包含选中状态和颜色）
interface TagState {
  name: string;
  color: string;
  selected: boolean;
  isNew: boolean;
}

type ViewMode = "list" | "create";

export function TagEditPopover({
  serviceId,
  tags,
  allTags,
  onUpdate,
  children,
}: TagEditPopoverProps) {
  const [open, setOpen] = useState(false);
  const [tagStates, setTagStates] = useState<Map<string, TagState>>(new Map());
  const [searchQuery, setSearchQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  
  // 创建表单状态
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_PRESET_COLORS[0]);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  // 打开时初始化状态
  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      const currentTags = tags.map(parseTag);
      const allParsedTags = allTags.map(parseTag);

      const states = new Map<string, TagState>();

      // 添加所有已知标签（从 allTags）
      for (const t of allParsedTags) {
        states.set(t.name, {
          name: t.name,
          color: t.color || DEFAULT_TAG_COLOR,
          selected: false,
          isNew: false,
        });
      }

      // 标记当前服务已选中的标签
      for (const t of currentTags) {
        const existing = states.get(t.name);
        if (existing) {
          existing.selected = true;
        } else {
          states.set(t.name, {
            name: t.name,
            color: t.color || DEFAULT_TAG_COLOR,
            selected: true,
            isNew: false,
          });
        }
      }

      setTagStates(states);
      setSearchQuery("");
      setViewMode("list");
      setNewTagName("");
      setNewTagColor(TAG_PRESET_COLORS[0]);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  // 切换到创建视图
  const switchToCreate = () => {
    setNewTagName(searchQuery.trim());
    setNewTagColor(TAG_PRESET_COLORS[0]);
    setViewMode("create");
    setTimeout(() => createInputRef.current?.focus(), 100);
  };

  // 返回列表视图
  const switchToList = () => {
    setViewMode("list");
    setSearchQuery("");
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // 创建新标签
  const handleCreateTag = () => {
    const trimmed = newTagName.trim();
    if (!trimmed || tagStates.has(trimmed)) return;

    setTagStates((prev) => {
      const next = new Map(prev);
      next.set(trimmed, {
        name: trimmed,
        color: newTagColor,
        selected: true,
        isNew: true,
      });
      return next;
    });

    // 返回列表视图
    setViewMode("list");
    setSearchQuery("");
    setNewTagName("");
    setNewTagColor(TAG_PRESET_COLORS[0]);
  };

  // 过滤并排序标签列表
  const filteredTags = useMemo(() => {
    const allNames = Array.from(tagStates.keys()).sort();
    const query = searchQuery.toLowerCase().trim();
    if (!query) return allNames;
    return allNames.filter((name) => name.toLowerCase().includes(query));
  }, [tagStates, searchQuery]);

  // 切换标签选中状态
  const toggleTag = (name: string) => {
    setTagStates((prev) => {
      const next = new Map(prev);
      const state = next.get(name);
      if (state) {
        next.set(name, { ...state, selected: !state.selected });
      }
      return next;
    });
  };

  // 保存
  const handleSave = async () => {
    setSaving(true);
    try {
      const finalTags: string[] = [];
      for (const [, state] of tagStates) {
        if (state.selected) {
          finalTags.push(serializeTag(state.name, state.color));
        }
      }

      await api.updateServiceTags(serviceId, finalTags);
      onUpdate();
      setOpen(false);
      notification({
        status: "success",
        title: "标签已更新",
      });
    } catch (err) {
      const apiErr = err as { message?: string };
      notification({
        status: "error",
        title: "更新失败",
        description: apiErr.message || "更新标签失败",
      });
    } finally {
      setSaving(false);
    }
  };

  // 计算选中的标签数量
  const selectedCount = useMemo(() => {
    let count = 0;
    for (const [, state] of tagStates) {
      if (state.selected) count++;
    }
    return count;
  }, [tagStates]);

  // 是否有变化
  const hasChanges = useMemo(() => {
    const currentParsed = tags.map(parseTag);
    const currentSet = new Set(currentParsed.map((t) => t.name));

    for (const [name, state] of tagStates) {
      const wasSelected = currentSet.has(name);
      if (state.selected !== wasSelected) return true;
    }

    return false;
  }, [tagStates, tags]);

  // 检查是否可以创建新标签
  const canCreateNewTag = searchQuery.trim() && !tagStates.has(searchQuery.trim());
  
  // 检查创建表单是否有效
  const canSubmitCreate = newTagName.trim() && !tagStates.has(newTagName.trim());

  return (
    <Popover.Root open={open} onOpenChange={handleOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Content align="end" className="w-[300px] p-0" showArrow={false}>
        {viewMode === "list" ? (
          <>
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-stroke-soft-200 px-4 py-3">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary-alpha-10">
                <RiPriceTag3Line className="size-4 text-primary-base" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-text-strong-950">编辑标签</h3>
                <p className="text-xs text-text-sub-600">
                  已选择 {selectedCount} 个标签
                </p>
              </div>
            </div>

            {/* 搜索/添加框 */}
            <div className="border-b border-stroke-soft-200 p-3">
              <Input.Root size="small">
                <Input.Wrapper>
                  <Input.Icon as={RiSearchLine} />
                  <Input.Input
                    ref={inputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canCreateNewTag) {
                        e.preventDefault();
                        switchToCreate();
                      }
                    }}
                    placeholder="搜索或输入新标签..."
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

              {/* 创建新标签按钮 */}
              {canCreateNewTag && (
                <button
                  type="button"
                  onClick={switchToCreate}
                  className="mt-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-stroke-soft-200 px-3 py-2 text-sm text-text-sub-600 transition-colors hover:border-primary-base hover:bg-primary-alpha-10 hover:text-primary-base"
                >
                  <RiAddLine className="size-4" />
                  <span>创建标签 &quot;{searchQuery.trim()}&quot;</span>
                </button>
              )}
            </div>

            {/* 标签列表 */}
            <div className="max-h-60 overflow-y-auto p-2">
              {filteredTags.length > 0 ? (
                <div className="space-y-0.5">
                  {filteredTags.map((name) => {
                    const state = tagStates.get(name)!;
                    const isSelected = state.selected;

                    return (
                      <div
                        key={name}
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleTag(name)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleTag(name);
                          }
                        }}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all",
                        isSelected
                          ? "bg-primary-alpha-10 text-primary-base"
                          : "text-text-sub-600 hover:bg-bg-soft-200 hover:text-text-strong-950"
                      )}
                      >
                        <Checkbox.Root
                          checked={isSelected}
                          onCheckedChange={() => toggleTag(name)}
                        />

                        {/* 颜色指示器 */}
                        <span
                          className="size-3 rounded-full shrink-0 ring-1 ring-inset ring-black/10"
                          style={{ backgroundColor: state.color }}
                        />

                        <span className="flex-1 text-left truncate">{name}</span>

                        {/* 新标签标记 */}
                        {state.isNew && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-alpha-10 text-primary-base">
                            新建
                          </span>
                        )}

                        {isSelected && (
                          <RiCheckLine className="size-4 shrink-0 text-primary-base" />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : searchQuery ? (
                <div className="py-8 text-center text-sm text-text-soft-400">
                  没有找到标签 &quot;{searchQuery}&quot;
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-text-soft-400">
                  暂无可用标签，输入创建新标签
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-stroke-soft-200 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setTagStates((prev) => {
                    const next = new Map(prev);
                    for (const [name, state] of next) {
                      next.set(name, { ...state, selected: false });
                    }
                    return next;
                  });
                }}
                className="text-xs text-text-soft-400 hover:text-error-base disabled:opacity-50"
                disabled={selectedCount === 0}
              >
                清空选择
              </button>
              <div className="flex items-center gap-2">
                <Button.Root
                  size="xsmall"
                  variant="neutral"
                  mode="ghost"
                  onClick={() => setOpen(false)}
                >
                  取消
                </Button.Root>
                <Button.Root
                  size="xsmall"
                  onClick={handleSave}
                  disabled={saving || !hasChanges}
                >
                  {saving && <Button.Icon as={RiLoader4Line} className="animate-spin" />}
                  保存
                </Button.Root>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* 创建视图 Header */}
            <div className="flex items-center gap-2 border-b border-stroke-soft-200 px-4 py-3">
              <button
                type="button"
                onClick={switchToList}
                className="flex size-8 items-center justify-center rounded-lg hover:bg-bg-weak-50 text-text-sub-600"
              >
                <RiArrowLeftLine className="size-4" />
              </button>
              <div>
                <h3 className="text-sm font-medium text-text-strong-950">新建标签</h3>
                <p className="text-xs text-text-sub-600">
                  创建一个新的服务标签
                </p>
              </div>
            </div>

            {/* 创建表单 */}
            <div className="p-4 space-y-4">
              {/* 标签名称 */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-strong-950">
                  标签名称 <span className="text-error-base">*</span>
                </label>
                <Input.Root size="small">
                  <Input.Wrapper>
                    <Input.Input
                      ref={createInputRef}
                      type="text"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && canSubmitCreate) {
                          e.preventDefault();
                          handleCreateTag();
                        }
                      }}
                      placeholder="输入标签名称"
                    />
                  </Input.Wrapper>
                </Input.Root>
                {newTagName.trim() && tagStates.has(newTagName.trim()) && (
                  <p className="text-xs text-error-base">标签已存在</p>
                )}
              </div>

              {/* 标签颜色 */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-strong-950">
                  标签颜色
                </label>
                <TagColorPicker value={newTagColor} onChange={setNewTagColor} />
              </div>
            </div>

            {/* 创建视图 Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-stroke-soft-200 px-4 py-3">
              <Button.Root
                size="xsmall"
                variant="neutral"
                mode="ghost"
                onClick={switchToList}
              >
                取消
              </Button.Root>
              <Button.Root
                size="xsmall"
                onClick={handleCreateTag}
                disabled={!canSubmitCreate}
              >
                创建
              </Button.Root>
            </div>
          </>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}
