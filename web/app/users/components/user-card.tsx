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
import type { ServiceGroup, ServiceSummary, UserSummary } from "@/lib/api";
import { ServicePermissionSummary } from "./service-permission-summary";

export interface UserCardProps {
	user: UserSummary;
	selected: boolean;
	isAdmin: boolean;
	services: ServiceSummary[];
	groups: ServiceGroup[];
	onToggle: () => void;
	onEdit: () => void;
	onDelete: () => void;
}

export function UserCard({
	user,
	selected,
	isAdmin,
	services,
	groups,
	onToggle,
	onEdit,
	onDelete,
}: UserCardProps) {
	return (
		<div
			className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
				selected
					? "border-primary-base bg-primary-alpha-10"
					: "border-stroke-soft-200 bg-bg-white-0"
			}`}
			onClick={onEdit}
		>
			<div onClick={(e) => e.stopPropagation()}>
				<Checkbox.Root checked={selected} onCheckedChange={onToggle} />
			</div>

			<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-bg-weak-50">
				<RiUserLine className="size-4 text-text-sub-600" />
			</div>

			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-2">
					<div className="truncate text-sm font-medium text-text-strong-950">
						{user.username}
					</div>
					{user.is_admin && (
						<span className="shrink-0 rounded-md bg-primary-alpha-10 px-1.5 py-0.5 text-[11px] font-medium text-primary-base">
							系统管理员
						</span>
					)}
				</div>
				<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
					<ServicePermissionSummary
						serviceIds={user.service_ids}
						services={services}
						groups={groups}
						emptyLabel="无权限"
					/>
					{user.totp_enabled && (
						<span className="inline-flex items-center gap-0.5 text-xs text-success-base">
							<RiShieldCheckLine className="size-3" />
							2FA
						</span>
					)}
				</div>
			</div>

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
								<Dropdown.ItemIcon
									as={RiDeleteBinLine}
									className="text-error-base"
								/>
								删除
							</Dropdown.Item>
						</Dropdown.Content>
					</Dropdown.Root>
				</div>
			)}
		</div>
	);
}