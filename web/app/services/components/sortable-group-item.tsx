"use client";

import { RiDeleteBinLine, RiDraggable, RiEditLine } from "@remixicon/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as CompactButton from "@/components/ui/compact-button";
import type { ServiceGroup } from "@/lib/api";

export interface SortableGroupItemProps {
  group: ServiceGroup;
  onEdit: () => void;
  onDelete: () => void;
  isAdmin: boolean;
}

export function SortableGroupItem({
  group,
  onEdit,
  onDelete,
  isAdmin,
}: SortableGroupItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 rounded-lg border ${
        isDragging
          ? "border-primary-base bg-primary-alpha-10 shadow-lg z-10"
          : "border-stroke-soft-200 bg-bg-white-0"
      }`}
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-text-soft-400 hover:text-text-sub-600 touch-none"
        {...attributes}
        {...listeners}
      >
        <RiDraggable className="size-4" />
      </button>
      <div
        className="size-3 rounded-full shrink-0"
        style={{ backgroundColor: group.color || "#9ca3af" }}
      />
      <span className="flex-1 text-sm font-medium text-text-strong-950 truncate">
        {group.name}
      </span>
      {isAdmin && (
        <div className="flex items-center gap-1">
          <CompactButton.Root variant="ghost" size="medium" onClick={onEdit}>
            <CompactButton.Icon as={RiEditLine} />
          </CompactButton.Root>
          <CompactButton.Root variant="ghost" size="medium" onClick={onDelete}>
            <CompactButton.Icon as={RiDeleteBinLine} className="text-error-base" />
          </CompactButton.Root>
        </div>
      )}
    </div>
  );
}
