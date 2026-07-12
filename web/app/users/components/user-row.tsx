"use client";

import {
	RiDeleteBinLine,
	RiUserLine,
} from "@remixicon/react";
import * as Checkbox from "@/components/ui/checkbox";
import * as CompactButton from "@/components/ui/compact-button";
import type { ServiceGroup, ServiceSummary, UserSummary } from "@/lib/api";
import { ServicePermissionSummary } from "./service-permission-summary";

export interface UserRowProps {
	user: UserSummary;
	selected: boolean;
	isAdmin: boolean;
	services: ServiceSummary[];
	groups: ServiceGroup[];
	onToggle: () => void;
	onEdit: () => void;
	onDelete: () => void;
}

export function UserRow({
	user,
	selected,
	isAdmin,
	services,
	groups,
	onToggle,
	onEdit,
	onDelete,
}: UserRowProps) {
	return (
		<tr
			className={`cursor-pointer border-b border-stroke-soft-200 transition-colors last:border-0 ${
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
					<div className="flex min-w-0 items-center gap-2">
						<span className="font-medium text-text-strong-950">{user.username}</span>
						{user.is_admin && (
							<span className="shrink-0 rounded-md bg-primary-alpha-10 px-1.5 py-0.5 text-[11px] font-medium text-primary-base">
								系统管理员
							</span>
						)}
					</div>
				</div>
			</td>
			<td className="max-w-[12rem] px-4 py-2.5">
				<ServicePermissionSummary
					serviceIds={user.service_ids}
					services={services}
					groups={groups}
					emptyLabel="无"
				/>
			</td>
			<td className="px-4 py-3">
				{user.totp_enabled ? (
					<span className="text-xs text-green-500">已启用</span>
				) : (
					<span className="text-xs text-text-soft-400">未启用</span>
				)}
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