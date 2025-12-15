"use client";

import Link from "next/link";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { useState } from "react";
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
  RiStopCircleLine,
} from "@remixicon/react";
import * as Tag from "@/components/ui/tag";
import * as Checkbox from "@/components/ui/checkbox";
import * as CompactButton from "@/components/ui/compact-button";
import * as Tooltip from "@/components/ui/tooltip";
import * as Popover from "@/components/ui/popover";
import { type ServiceSummary, type ServiceGroup } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { TagEditPopover } from "./tag-edit-popover";
import { TagEditModal } from "./mobile/tag-edit-modal";
import { GroupSelectPopover } from "./group-select-popover";
import { GroupSelectModal } from "./mobile/group-select-modal";
import { StopServicePopover } from "./stop-service-popover";
import { parseTag, getTagColor } from "./tag-utils";

export const stateConfig = {
  running: { dot: "bg-success-base", text: "text-success-base", label: "运行中" },
  stopped: { dot: "bg-text-soft-400", text: "text-text-soft-400", label: "已停止" },
  unknown: { dot: "bg-away-base", text: "text-away-base", label: "未知" },
} as const;

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
  onToggleSelect: () => void;
  isDraggable?: boolean;
}

// 拖拽时显示的简化版卡片
export function ServiceCardDragOverlay({ service }: { service: ServiceSummary }) {
  const state = stateConfig[service.state];

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-primary-base bg-bg-white-0 shadow-lg cursor-grabbing">
      <RiDraggable className="size-4 text-text-soft-400" />
      <span className={`size-2.5 rounded-full shrink-0 ${state.dot}`} />
      <span className="text-xs font-normal text-text-strong-950 truncate">
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
}: ServiceCardProps) {
  const state = stateConfig[service.state];
  const isRunning = service.state === "running";

  // Modal/Popover 状态
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

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
      className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-colors ${
        isDragging
          ? "opacity-40 border-dashed border-stroke-sub-300 bg-bg-weak-50"
          : selected
            ? "border-primary-base bg-primary-alpha-10"
            : "border-stroke-soft-200 bg-bg-white-0 hover:border-stroke-sub-300"
      }`}
    >
      {/* 拖拽手柄 */}
      {isDraggable && (
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-text-soft-400 hover:text-text-sub-600 -ml-1 touch-none"
        >
          <RiDraggable className="size-4" />
        </div>
      )}

      {/* 多选框 */}
      <Checkbox.Root
        checked={selected}
        onCheckedChange={onToggleSelect}
      />

      {/* 状态指示器 */}
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className={`size-2.5 rounded-full shrink-0 ${state.dot}`} />
        </Tooltip.Trigger>
        <Tooltip.Content>{state.label}</Tooltip.Content>
      </Tooltip.Root>

      {/* 服务信息 */}
      <Link
        href={`/services/${service.id}`}
        className="flex-1 min-w-0"
      >
        <div className="text-xs font-normal text-text-strong-950 truncate transition-colors">
          {service.name}
        </div>
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
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
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
      <div className="flex items-center gap-0.5 shrink-0">
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
                {/* 桌面端：标签和分组 Popover 放外面 */}
                <div className="hidden sm:flex items-center gap-0.5">
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
                  <Popover.Content align="end" className="w-32 p-1" showArrow={false}>
                    {/* 移动端显示标签和分组选项 */}
                    <button
                      type="button"
                      onClick={() => { setMoreMenuOpen(false); setTagModalOpen(true); }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-sub-600 transition-colors hover:bg-bg-weak-50 hover:text-text-strong-950 sm:hidden"
                    >
                      <RiPriceTag3Line className="size-4" />
                      <span>编辑标签</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMoreMenuOpen(false); setGroupModalOpen(true); }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-sub-600 transition-colors hover:bg-bg-weak-50 hover:text-text-strong-950 sm:hidden"
                    >
                      <RiFolderLine className="size-4" />
                      <span>编辑分组</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMoreMenuOpen(false); onDuplicate(); }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-sub-600 transition-colors hover:bg-bg-weak-50 hover:text-text-strong-950"
                    >
                      <RiFileCopyLine className="size-4" />
                      <span>复制</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMoreMenuOpen(false); onEdit(); }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-sub-600 transition-colors hover:bg-bg-weak-50 hover:text-text-strong-950"
                    >
                      <RiEditLine className="size-4" />
                      <span>编辑</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setMoreMenuOpen(false); onDelete(); }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-error-base transition-colors hover:bg-error-lighter"
                    >
                      <RiDeleteBinLine className="size-4" />
                      <span>删除</span>
                    </button>
                  </Popover.Content>
                </Popover.Root>

                {/* 移动端 Modal */}
                <TagEditModal
                  open={tagModalOpen}
                  onOpenChange={setTagModalOpen}
                  serviceId={service.id}
                  tags={service.tags || []}
                  allTags={allTags}
                  onUpdate={onRefresh}
                />
                <GroupSelectModal
                  open={groupModalOpen}
                  onOpenChange={setGroupModalOpen}
                  serviceId={service.id}
                  currentGroup={service.group || null}
                  groups={allGroups}
                  onUpdate={onRefresh}
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
