"use client";

import {
  RiDeleteBinLine,
  RiEditLine,
  RiMoreLine,
  RiUserLine,
  RiShieldCheckLine,
} from "@remixicon/react";
import * as Checkbox from "@/components/ui/checkbox";
import * as Dropdown from "@/components/ui/dropdown";
import * as CompactButton from "@/components/ui/compact-button";
import type { UserSummary } from "@/lib/api";

export interface UserCardProps {
  user: UserSummary;
  selected: boolean;
  isAdmin: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function UserCard({
  user,
  selected,
  isAdmin,
  onToggle,
  onEdit,
  onDelete,
}: UserCardProps) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
        selected
          ? "border-primary-base bg-primary-alpha-10"
          : "border-stroke-soft-200 bg-bg-white-0"
      }`}
      onClick={onEdit}
    >
      {/* 多选框 */}
      <div onClick={(e) => e.stopPropagation()}>
        <Checkbox.Root checked={selected} onCheckedChange={onToggle} />
      </div>

      {/* 头像 */}
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-bg-weak-50">
        <RiUserLine className="size-4 text-text-sub-600" />
      </div>

      {/* 信息 */}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm text-text-strong-950 truncate">
          {user.username}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {user.service_ids.length === 0 ? (
            <span className="text-xs text-text-soft-400">无权限</span>
          ) : user.service_ids.includes("*") ? (
            <span className="text-xs text-away-base">全部服务</span>
          ) : (
            <>
              <span className="text-xs text-text-sub-600">
                {user.service_ids.length} 个服务
              </span>
            </>
          )}
          {user.totp_enabled && (
            <>
              <span className="text-text-soft-400">•</span>
              <span className="inline-flex items-center gap-0.5 text-xs text-success-base">
                <RiShieldCheckLine className="size-3" />
                2FA
              </span>
            </>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      {isAdmin && (
        <div onClick={(e) => e.stopPropagation()}>
          <Dropdown.Root>
            <Dropdown.Trigger asChild>
              <CompactButton.Root variant="ghost" size="medium">
                <CompactButton.Icon as={RiMoreLine} />
              </CompactButton.Root>
            </Dropdown.Trigger>
            <Dropdown.Content align="end" className="w-32">
              <Dropdown.Item onClick={onEdit}>
                <Dropdown.ItemIcon as={RiEditLine} />
                编辑
              </Dropdown.Item>
              <Dropdown.Item onClick={onDelete} className="text-error-base">
                <Dropdown.ItemIcon as={RiDeleteBinLine} className="text-error-base" />
                删除
              </Dropdown.Item>
            </Dropdown.Content>
          </Dropdown.Root>
        </div>
      )}
    </div>
  );
}
