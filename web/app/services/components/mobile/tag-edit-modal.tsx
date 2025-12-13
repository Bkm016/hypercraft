"use client";

import { useState, useMemo, useEffect } from "react";
import {
  RiAddLine,
  RiPriceTag3Line,
  RiSearchLine,
  RiCloseLine,
  RiCheckLine,
} from "@remixicon/react";
import * as Checkbox from "@/components/ui/checkbox";
import * as FormDialog from "@/components/ui/form-dialog";
import * as Input from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/utils/cn";
import { notification } from "@/hooks/use-notification";
import {
  parseTag,
  serializeTag,
  DEFAULT_TAG_COLOR,
  TAG_PRESET_COLORS,
} from "../tag-utils";
import { TagColorPicker } from "../tag-color-picker";

interface TagEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceId: string;
  tags: string[];
  allTags: string[];
  onUpdate: () => void;
}

interface TagState {
  name: string;
  color: string;
  selected: boolean;
  isNew: boolean;
}

export function TagEditModal({
  open,
  onOpenChange,
  serviceId,
  tags,
  allTags,
  onUpdate,
}: TagEditModalProps) {
  const [tagStates, setTagStates] = useState<Map<string, TagState>>(new Map());
  const [searchQuery, setSearchQuery] = useState("");
  const [saving, setSaving] = useState(false);
  
  // 新建标签的状态
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_PRESET_COLORS[0]);

  // 打开时初始化状态
  useEffect(() => {
    if (open) {
      const currentTags = tags.map(parseTag);
      const allParsedTags = allTags.map(parseTag);

      const states = new Map<string, TagState>();

      for (const t of allParsedTags) {
        states.set(t.name, {
          name: t.name,
          color: t.color || DEFAULT_TAG_COLOR,
          selected: false,
          isNew: false,
        });
      }

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
      setShowCreateForm(false);
      setNewTagName("");
      setNewTagColor(TAG_PRESET_COLORS[0]);
    }
  }, [open, tags, allTags]);

  const filteredTags = useMemo(() => {
    const allNames = Array.from(tagStates.keys()).sort();
    const query = searchQuery.toLowerCase().trim();
    if (!query) return allNames;
    return allNames.filter((name) => name.toLowerCase().includes(query));
  }, [tagStates, searchQuery]);

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

  const handleCreateTag = (e: React.FormEvent) => {
    e.preventDefault();
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

    setNewTagName("");
    setNewTagColor(TAG_PRESET_COLORS[0]);
    setShowCreateForm(false);
    setSearchQuery("");
  };

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
      onOpenChange(false);
      // 所有后续操作都延迟到动画完成后
      setTimeout(() => {
        notification({ status: "success", title: "标签已更新" });
        onUpdate();
      }, 200);
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

  const selectedCount = useMemo(() => {
    let count = 0;
    for (const [, state] of tagStates) {
      if (state.selected) count++;
    }
    return count;
  }, [tagStates]);

  const hasChanges = useMemo(() => {
    const currentParsed = tags.map(parseTag);
    const currentSet = new Set(currentParsed.map((t) => t.name));

    for (const [name, state] of tagStates) {
      const wasSelected = currentSet.has(name);
      if (state.selected !== wasSelected) return true;
    }

    return false;
  }, [tagStates, tags]);

  const canCreateNewTag = newTagName.trim() && !tagStates.has(newTagName.trim());

  return (
    <FormDialog.Root open={open} onOpenChange={onOpenChange}>
      <FormDialog.Content>
        <div>
          <FormDialog.Header
            icon={RiPriceTag3Line}
            title="编辑标签"
            description={`已选择 ${selectedCount} 个标签`}
          />
          <FormDialog.Body noPadding className="flex flex-col">
            {/* 搜索框 + 新建按钮 */}
            <div className="border-b border-stroke-soft-200 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Input.Root size="small" className="flex-1">
                  <Input.Wrapper>
                    <Input.Icon as={RiSearchLine} />
                    <Input.Input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="搜索标签..."
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
                <button
                  type="button"
                  onClick={() => setShowCreateForm(!showCreateForm)}
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                    showCreateForm
                      ? "bg-primary-base text-white"
                      : "bg-bg-weak-50 text-text-sub-600 hover:bg-bg-soft-200"
                  )}
                >
                  <RiAddLine className="size-5" />
                </button>
              </div>

              {/* 新建标签表单 - 内嵌显示 */}
              {showCreateForm && (
                <form onSubmit={handleCreateTag} className="rounded-lg border border-stroke-soft-200 bg-bg-weak-50 p-3 space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-sub-600">标签名称</label>
                    <Input.Root size="small">
                      <Input.Wrapper>
                        <Input.Input
                          type="text"
                          value={newTagName}
                          onChange={(e) => setNewTagName(e.target.value)}
                          placeholder="输入标签名称"
                          autoFocus
                        />
                      </Input.Wrapper>
                    </Input.Root>
                    {newTagName.trim() && tagStates.has(newTagName.trim()) && (
                      <p className="text-xs text-error-base">标签已存在</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-sub-600">标签颜色</label>
                    <TagColorPicker value={newTagColor} onChange={setNewTagColor} />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateForm(false);
                        setNewTagName("");
                      }}
                      className="px-3 py-1.5 text-xs text-text-sub-600 hover:text-text-strong-950"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={!canCreateNewTag}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-primary-base rounded-lg disabled:opacity-50 hover:opacity-90"
                    >
                      创建
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* 标签列表 */}
            <div className="flex-1 overflow-y-auto">
              {filteredTags.length > 0 ? (
                <div className="p-2 space-y-0.5">
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
                          "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-sm transition-all",
                          isSelected
                            ? "bg-primary-alpha-10 text-primary-base"
                            : "text-text-sub-600 active:bg-bg-soft-200"
                        )}
                      >
                        <Checkbox.Root
                          checked={isSelected}
                          onCheckedChange={() => toggleTag(name)}
                        />
                        <span
                          className="size-3 rounded-full shrink-0 ring-1 ring-inset ring-black/10"
                          style={{ backgroundColor: state.color }}
                        />
                        <span className="flex-1 text-left truncate">{name}</span>
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
              ) : (
                <div className="px-4 py-8 text-center text-sm text-text-soft-400">
                  {searchQuery ? (
                    <>没有找到标签 &quot;{searchQuery}&quot;</>
                  ) : (
                    <>暂无标签，点击右上角 + 创建</>
                  )}
                </div>
              )}
            </div>
          </FormDialog.Body>
          <FormDialog.Footer className="justify-between">
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
            </div>
          </FormDialog.Footer>
        </div>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
