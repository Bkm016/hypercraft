"use client";

import {
  RiDeleteBinLine,
  RiUserLine,
} from "@remixicon/react";
import * as Checkbox from "@/components/ui/checkbox";
import * as CompactButton from "@/components/ui/compact-button";
import type { UserSummary } from "@/lib/api";

export interface UserRowProps {
  user: UserSummary;
  selected: boolean;
  isAdmin: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function UserRow({
  user,
  selected,
  isAdmin,
  onToggle,
  onEdit,
  onDelete,
}: UserRowProps) {
  return (
    <tr
      className={`border-b border-stroke-soft-200 transition-colors last:border-0 cursor-pointer ${
        selected ? "bg-primary-alpha-10" : "hover:bg-bg-weak-50"
      }`}
      onClick={onEdit}
    >
      <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
        <Checkbox.Root
          checked={selected}
          onCheckedChange={onToggle}
        />
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-full bg-bg-weak-50">
            <RiUserLine className="size-4 text-text-sub-600" />
          </div>
          <span className="font-medium text-text-strong-950">{user.username}</span>
        </div>
      </td>
      <td className="px-4 py-2">
        <div className="flex flex-wrap gap-1">
          {user.service_ids.length === 0 ? (
            <span className="text-xs text-text-soft-400">无权限</span>
          ) : user.service_ids.includes("*") ? (
            <span className="rounded bg-away-lighter px-1.5 py-0.5 text-xs text-away-base">
              全部服务
            </span>
          ) : (
            user.service_ids.slice(0, 3).map((s) => (
              <span
                key={s}
                className="rounded bg-bg-weak-50 px-1.5 py-0.5 text-xs text-text-sub-600"
              >
                {s}
              </span>
            ))
          )}
          {user.service_ids.length > 3 && !user.service_ids.includes("*") && (
            <span className="rounded bg-bg-weak-50 px-1.5 py-0.5 text-xs text-text-sub-600">
              +{user.service_ids.length - 3}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-text-sub-600">
        {user.created_at ? new Date(user.created_at).toLocaleString("zh-CN") : "—"}
      </td>
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        {isAdmin && (
          <CompactButton.Root
            variant="ghost"
            size="medium"
            onClick={onDelete}
          >
            <CompactButton.Icon as={RiDeleteBinLine} className="text-error-base" />
          </CompactButton.Root>
        )}
      </td>
    </tr>
  );
}
