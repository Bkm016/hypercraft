"use client";

import type { ServiceGroup, ServiceSummary } from "@/lib/api";
import { cn } from "@/utils/cn";

export interface ServicePermissionSummaryProps {
	serviceIds: string[];
	services: ServiceSummary[];
	groups?: ServiceGroup[];
	emptyLabel?: string;
	className?: string;
	maxDots?: number;
}

/**
 * 用户管理列表中的服务权限摘要（色点 + 文案，hover 看全量 title）
 */
export function ServicePermissionSummary({
	serviceIds,
	services,
	groups = [],
	emptyLabel = "无",
	className,
	maxDots = 4,
}: ServicePermissionSummaryProps) {
	if (serviceIds.length === 0) {
		return (
			<span className={cn("text-xs text-text-soft-400", className)}>
				{emptyLabel}
			</span>
		);
	}

	if (serviceIds.includes("*")) {
		return (
			<div
				className={cn("flex min-w-0 items-center gap-2", className)}
				title="全部服务"
			>
				<span className="size-2 shrink-0 rounded-full bg-away-base" />
				<span className="truncate text-xs text-text-sub-600">全部服务</span>
			</div>
		);
	}

	const groupById = new Map(groups.map((g) => [g.id, g]));
	const resolved = serviceIds
		.map((id) => services.find((s) => s.id === id))
		.filter((s): s is ServiceSummary => s != null);
	const fallbackCount = serviceIds.length - resolved.length;
	const allTitles = [
		...resolved.map((s) => s.name),
		...serviceIds
			.filter((id) => !services.some((s) => s.id === id))
			.map((id) => id),
	];
	const title = allTitles.join("、");

	if (resolved.length === 0 && fallbackCount > 0) {
		return (
			<span
				className={cn("truncate text-xs text-text-sub-600", className)}
				title={title}
			>
				{serviceIds.length} 个服务
			</span>
		);
	}

	const dots = resolved.slice(0, maxDots);
	const label =
		resolved.length === 1
			? resolved[0].name
			: `${resolved.length + fallbackCount} 个服务`;

	return (
		<div
			className={cn("flex min-w-0 items-center gap-2", className)}
			title={title}
		>
			<div className="flex shrink-0 items-center -space-x-0.5">
				{dots.map((svc) => {
					const group = svc.group ? groupById.get(svc.group) : undefined;
					return (
						<span
							key={svc.id}
							className="size-2 rounded-full ring-2 ring-bg-white-0"
							style={{
								backgroundColor: group?.color ?? "#a3a3a3",
							}}
						/>
					);
				})}
			</div>
			<span className="min-w-0 truncate text-xs text-text-sub-600">
				{label}
			</span>
		</div>
	);
}