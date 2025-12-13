"use client";

import { useState, useMemo, useRef } from "react";
import {
  RiPriceTag3Line,
  RiArrowDownSLine,
  RiCheckLine,
  RiSearchLine,
  RiCloseLine,
  RiCheckboxMultipleLine,
  RiCheckboxBlankLine,
} from "@remixicon/react";
import * as Popover from "@/components/ui/popover";

import * as Input from "@/components/ui/input";
import * as Checkbox from "@/components/ui/checkbox";
import { cn } from "@/utils/cn";
import { parseTag, getTagColor } from "./tag-utils";

interface TagFilterProps {
  allTags: string[];
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
}

export function TagFilter({ allTags, selectedTags, onTagsChange }: TagFilterProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  if (allTags.length === 0) return null;

  // 过滤标签（按标签名搜索，忽略颜色部分）
  const filteredTags = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return allTags;
    return allTags.filter((rawTag) => {
      const parsed = parseTag(rawTag);
      return parsed.name.toLowerCase().includes(query);
    });
  }, [allTags, searchQuery]);

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onTagsChange(selectedTags.filter((t) => t !== tag));
    } else {
      onTagsChange([...selectedTags, tag]);
    }
  };

  const clearAll = () => {
    onTagsChange([]);
  };

  const selectAll = () => {
    onTagsChange([...new Set([...selectedTags, ...filteredTags])]);
  };

  const hasSelection = selectedTags.length > 0;
  const allFilteredSelected = filteredTags.length > 0 && filteredTags.every((t) => selectedTags.includes(t));

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setSearchQuery("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 h-9 px-3 text-sm rounded-lg border transition-colors",
            hasSelection
              ? "border-primary-base bg-primary-alpha-10 text-text-strong-950"
              : "border-stroke-soft-200 bg-bg-white-0 text-text-sub-600 hover:border-stroke-sub-300"
          )}
        >
          <RiPriceTag3Line className="size-4" />
          <span>标签</span>
          {hasSelection && (
            <span className="tabular-nums">{selectedTags.length}</span>
          )}
          <RiArrowDownSLine className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </Popover.Trigger>
      <Popover.Content align="start" className="w-[280px] p-0" showArrow={false}>
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-stroke-soft-200 px-4 py-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary-alpha-10">
            <RiPriceTag3Line className="size-4 text-primary-base" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-text-strong-950">按标签筛选</h3>
            <p className="text-xs text-text-sub-600">
              已选择 {selectedTags.length} / {allTags.length} 个标签
            </p>
          </div>
        </div>

        {/* 搜索框 */}
        {allTags.length > 5 && (
          <div className="border-b border-stroke-soft-200 p-3">
            <Input.Root size="small">
              <Input.Wrapper>
                <Input.Icon as={RiSearchLine} />
                <Input.Input
                  ref={inputRef}
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
          </div>
        )}

        {/* 工具栏 */}
        <div className="flex items-center justify-between border-b border-stroke-soft-200 px-4 py-2">
          <button
            type="button"
            onClick={allFilteredSelected ? clearAll : selectAll}
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
          {hasSelection && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-text-soft-400 hover:text-error-base"
            >
              清空选择
            </button>
          )}
        </div>

        {/* 标签列表 */}
        <div className="max-h-60 overflow-y-auto p-2">
          {filteredTags.length > 0 ? (
            <div className="space-y-0.5">
              {filteredTags.map((rawTag) => {
                const parsed = parseTag(rawTag);
                const color = getTagColor(parsed);
                const isSelected = selectedTags.includes(rawTag);
                return (
                  <div
                    key={rawTag}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleTag(rawTag)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleTag(rawTag);
                      }
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
                      isSelected
                        ? "bg-primary-alpha-10 text-primary-base"
                        : "text-text-sub-600 hover:bg-bg-soft-200 hover:text-text-strong-950"
                    )}
                  >
                    <Checkbox.Root
                      checked={isSelected}
                      onCheckedChange={() => toggleTag(rawTag)}
                    />
                    {/* 颜色指示器 */}
                    <span
                      className="size-3 rounded-full shrink-0 ring-1 ring-inset ring-black/10"
                      style={{ backgroundColor: color }}
                    />
                    <span className="flex-1 text-left truncate">{parsed.name}</span>
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
              暂无可用标签
            </div>
          )}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
