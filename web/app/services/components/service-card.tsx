"use client";

import Link from "next/link";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { useState, useEffect } from "react";
import {
  RiDeleteBinLine,
  RiDraggable,
  RiEditLine,
  RiFileCopyLine,
  RiFolderLine,
  RiLoader4Line,
  RiMoreLine,
  RiPlayCircleLine,
  RiPriceTag3Line,
  RiStarFill,
  RiStarLine,
  RiStopCircleLine,
} from "@remixicon/react";
import { isFavorite, addFavorite, removeFavorite } from "@/lib/favorites";
import * as Tag from "@/components/ui/tag";
import * as Checkbox from "@/components/ui/checkbox";
import * as CompactButton from "@/components/ui/compact-button";
import * as Tooltip from "@/components/ui/tooltip";
import * as Popover from "@/components/ui/popover";
import { MenuItem } from "@/components/ui/menu-item";
import { ServiceStatusDot, SERVICE_STATE_CONFIG } from "@/components/ui/service-status";
import { type ServiceSummary, type ServiceGroup } from "@/lib/api";
import { TagEditPopover } from "./tag-edit-popover";
import { GroupSelectPopover } from "./group-select-popover";
import { StopServicePopover } from "./stop-service-popover";
import { parseTag, getTagColor } from "./tag-utils";

// 兼容旧引用：状态配置已统一到 ServiceStatus 组件
export const stateConfig = SERVICE_STATE_CONFIG;

export interface ServiceCardProps {
  service: ServiceSummary;
  allTags: string[];
  allGroups: ServiceGroup[];
  onAction: (action: "start" | "stop" | "restart" | "shutdown" | "kill") => void;
  onRefresh: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  operating: boolean;
  isAdmin: boolean;
  selected: boolean;
  onToggleSelect: (shiftKey: boolean) => void;
  isDraggable?: boolean;
  /** 分组内列表：无单行边框，与组容器共用一张卡 */
  compact?: boolean;
}

// 拖拽浮层与组内 compact 行同款单行排版，仅加描边便于跟手
export function ServiceCardDragOverlay({ service }: { service: ServiceSummary }) {
  const isRunning = service.state === "running";

  return (
    <div className="flex cursor-grabbing items-center gap-3 rounded-lg border border-stroke-sub-300 bg-bg-white-0 py-2 pl-2 pr-4 shadow-overlay">
      <span className="flex w-6 shrink-0 items-center justify-center text-text-soft-400">
        <RiDraggable className="size-4" />
      </span>
      <ServiceStatusDot state={service.state} size="sm" />
      <span className={`min-w-0 flex-1 truncate text-sm font-medium ${isRunning ? "text-text-strong-950" : "text-text-soft-400"}`}>
        {service.name}
      </span>
    </div>
  );
}

export function ServiceCard({
  service,
  allTags,
  allGroups,
  onAction,
  onRefresh,
  onDelete,
  onEdit,
  onDuplicate,
  operating,
  isAdmin,
  selected,
  onToggleSelect,
  isDraggable = false,
  compact = false,
}: ServiceCardProps) {
  const state = stateConfig[service.state];
  const isRunning = service.state === "running";

  // Popover 状态
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [favorited, setFavorited] = useState(false);

  useEffect(() => {
    setFavorited(isFavorite(service.id));
  }, [service.id]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: service.id,
    disabled: !isDraggable,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex transition-colors ${
        compact ? "items-stretch" : "items-center gap-2 rounded-lg border px-2.5 py-1.5"
      } ${
        compact
          ? isDragging
            ? "opacity-40 bg-bg-weak-50"
            : selected
              ? "bg-primary-alpha-10"
              : "hover:bg-bg-weak-50"
          : isDragging
            ? "opacity-40 border border-dashed border-stroke-sub-300 bg-bg-weak-50"
            : selected
              ? "border border-primary-base bg-primary-alpha-10"
              : "border border-stroke-soft-200 bg-bg-white-0 hover:border-stroke-sub-300"
      }`}
    >
      {compact && isDraggable ? (
        <div
          {...attributes}
          {...listeners}
          className="flex w-6 shrink-0 cursor-grab touch-none items-center justify-center text-text-soft-400 active:cursor-grabbing hover:text-text-sub-600"
          aria-label="拖拽排序"
        >
          <RiDraggable className="size-4" />
        </div>
      ) : null}

      {!compact && isDraggable ? (
        <div
          {...attributes}
          {...listeners}
          className="flex w-6 shrink-0 cursor-grab touch-none items-center justify-center text-text-soft-400 active:cursor-grabbing hover:text-text-sub-600"
          aria-label="拖拽排序"
        >
          <RiDraggable className="size-4" />
        </div>
      ) : null}

      <div
        className={
          compact
            ? `flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-3 sm:pr-4 ${isDraggable ? "" : "pl-3 sm:pl-4"}`
            : "contents"
        }
      >
      <div
        className="flex shrink-0 items-center"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          if (e.shiftKey) {
            e.preventDefault();
            onToggleSelect(true);
          }
        }}
      >
        <Checkbox.Root
          checked={selected}
          onCheckedChange={() => onToggleSelect(false)}
        />
      </div>

      {/* 状态点：running 呼吸，hover 出状态文案 */}
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="flex shrink-0 items-center justify-center px-0.5">
            <ServiceStatusDot state={service.state} size="sm" />
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content>{state.label}</Tooltip.Content>
      </Tooltip.Root>

      {/* 服务信息：仅名称单行 */}
      <Link href={`/services/${service.id}`} className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm font-medium ${
            isRunning ? "text-text-strong-950" : "text-text-soft-400"
          }`}
        >
          {service.name}
        </span>
      </Link>

      {/* 标签 - 移动端只显示颜色圆点 */}
      {service.tags && service.tags.length > 0 && (
        <>
          {/* 移动端：颜色圆点 */}
          <div className="flex sm:hidden items-center gap-1 shrink-0">
            {service.tags.slice(0, 3).map((rawTag) => {
              const parsed = parseTag(rawTag);
              const color = getTagColor(parsed);
              return (
                <span
                  key={rawTag}
                  className="size-2 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
              );
            })}
            {service.tags.length > 3 && (
              <span className="text-[10px] text-text-soft-400">+{service.tags.length - 3}</span>
            )}
          </div>

          {/* 桌面端：完整标签 */}
          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
            {service.tags.slice(0, 2).map((rawTag) => {
              const parsed = parseTag(rawTag);
              const color = getTagColor(parsed);
              return (
                <Tag.Root
                  key={rawTag}
                  variant="gray"
                  className="gap-1.5"
                  style={{
                    backgroundColor: `${color}1a`,
                    color: color,
                  }}
                >
                  <span
                    className="size-2 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  {parsed.name}
                </Tag.Root>
              );
            })}
            {service.tags.length > 2 && (
              <span className="text-xs text-text-soft-400">+{service.tags.length - 2}</span>
            )}
          </div>
        </>
      )}

      {/* 操作按钮 */}
      <div className="flex shrink-0 items-center gap-0.5">
        {/* 收藏按钮 */}
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <CompactButton.Root
              variant="ghost"
              size="medium"
              onClick={() => {
                if (favorited) {
                  removeFavorite(service.id);
                  setFavorited(false);
                } else {
                  addFavorite(service.id);
                  setFavorited(true);
                }
              }}
            >
              <CompactButton.Icon
                as={favorited ? RiStarFill : RiStarLine}
                className={favorited ? "text-away-base" : ""}
              />
            </CompactButton.Root>
          </Tooltip.Trigger>
          <Tooltip.Content>{favorited ? "取消收藏" : "收藏"}</Tooltip.Content>
        </Tooltip.Root>

        {operating ? (
          <RiLoader4Line className="size-4 animate-spin text-text-soft-400 mx-2" />
        ) : (
          <>
            {isRunning ? (
              <StopServicePopover
                onShutdown={() => onAction("shutdown")}
                onKill={() => onAction("kill")}
              >
                <CompactButton.Root variant="ghost" size="medium">
                  <CompactButton.Icon as={RiStopCircleLine} className="text-error-base" />
                </CompactButton.Root>
              </StopServicePopover>
            ) : (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <CompactButton.Root
                    variant="ghost"
                    size="medium"
                    onClick={() => onAction("start")}
                  >
                    <CompactButton.Icon as={RiPlayCircleLine} className="text-success-base" />
                  </CompactButton.Root>
                </Tooltip.Trigger>
                <Tooltip.Content>启动</Tooltip.Content>
              </Tooltip.Root>
            )}
            {isAdmin && (
              <>
                {/* 标签和分组 Popover：所有断点常驻显示 */}
                <div className="flex items-center gap-0.5">
                  <TagEditPopover
                    serviceId={service.id}
                    tags={service.tags || []}
                    allTags={allTags}
                    onUpdate={onRefresh}
                  >
                    <CompactButton.Root variant="ghost" size="medium">
                      <CompactButton.Icon as={RiPriceTag3Line} />
                    </CompactButton.Root>
                  </TagEditPopover>
                  <GroupSelectPopover
                    serviceId={service.id}
                    currentGroup={service.group || null}
                    groups={allGroups}
                    onUpdate={onRefresh}
                  >
                    <CompactButton.Root variant="ghost" size="medium">
                      <CompactButton.Icon as={RiFolderLine} />
                    </CompactButton.Root>
                  </GroupSelectPopover>
                </div>

                {/* 更多操作菜单 */}
                <Popover.Root open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
                  <Popover.Trigger asChild>
                    <CompactButton.Root variant="ghost" size="medium">
                      <CompactButton.Icon as={RiMoreLine} />
                    </CompactButton.Root>
                  </Popover.Trigger>
                  <Popover.Content align="end" className="w-36 p-1" showArrow={false}>
                    <MenuItem
                      icon={RiFileCopyLine}
                      onClick={() => { setMoreMenuOpen(false); onDuplicate(); }}
                    >
                      复制
                    </MenuItem>
                    <MenuItem
                      icon={RiEditLine}
                      onClick={() => { setMoreMenuOpen(false); onEdit(); }}
                    >
                      编辑
                    </MenuItem>
                    <MenuItem
                      icon={RiDeleteBinLine}
                      destructive
                      onClick={() => { setMoreMenuOpen(false); onDelete(); }}
                    >
                      删除
                    </MenuItem>
                  </Popover.Content>
                </Popover.Root>
              </>
            )}
          </>
        )}
      </div>
      </div>
    </div>
  );
}
