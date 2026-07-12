"use client";

import {
	RiKeyLine,
	RiRefreshLine,
	RiServerLine,
	RiUserLine,
} from "@remixicon/react";
import * as Button from "@/components/ui/button";
import { PageCard } from "@/components/layout/page-layout";
import type { TokenClaims, ServiceGroup, ServiceSummary } from "@/lib/api";

interface AccountPanelProps {
	user: TokenClaims;
	services: ServiceSummary[];
	groups: ServiceGroup[];
	refreshing: boolean;
	onRefreshToken: () => void;
}

export function AccountPanel({
	user,
	services,
	groups,
	refreshing,
	onRefreshToken,
}: AccountPanelProps) {
	const getTokenExpiry = () => {
		const expiryTime = user.exp * 1000;
		const now = Date.now();
		const diff = expiryTime - now;

		if (diff <= 0) {
			return "已过期";
		}

		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(minutes / 60);

		if (hours > 0) {
			return `${hours} 小时 ${minutes % 60} 分钟后`;
		}
		return `${minutes} 分钟后`;
	};

	const formatDate = (timestamp: number) => {
		return new Date(timestamp * 1000).toLocaleString("zh-CN", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
	};

	const serviceIds = user.service_ids ?? [];
	const groupById = new Map(groups.map((g) => [g.id, g]));
	const permittedServices = serviceIds.includes("*")
		? null
		: serviceIds
				.map((id) => services.find((s) => s.id === id))
				.filter((s): s is ServiceSummary => s != null);

	return (
		<div className="space-y-6">
			<PageCard title="账号资料" description="当前登录身份与可访问范围">
				<div className="flex items-center gap-3 rounded-lg bg-bg-weak-50 px-4 py-3">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-bg-white-0">
						<RiUserLine className="size-5 text-text-sub-600" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-medium text-text-strong-950">
							{user.username}
						</p>
						<p className="mt-0.5 text-xs text-text-sub-600">
							{user.sub === "__devtoken__"
								? "超级管理员"
								: user.is_admin
									? "系统管理员"
									: "普通用户"}
							<span className="text-text-soft-400"> · </span>
							<span className="font-mono text-[11px] text-text-soft-400">
								{user.sub}
							</span>
						</p>
						<p className="mt-1 text-xs text-text-soft-400">
							令牌签发于 {formatDate(user.iat)}
						</p>
					</div>
				</div>

				{user.sub !== "__devtoken__" && (
					<div className="mt-4">
						<p className="mb-2 text-xs font-medium text-text-soft-400">
							服务权限
						</p>
						{serviceIds.includes("*") ? (
							<div className="flex items-center gap-2.5 rounded-lg bg-bg-weak-50 px-3 py-2.5">
								<span className="size-2 shrink-0 rounded-full bg-away-base" />
								<span className="text-sm font-medium text-text-strong-950">
									全部服务
								</span>
							</div>
						) : permittedServices && permittedServices.length > 0 ? (
							<div className="max-h-52 space-y-1.5 overflow-y-auto overscroll-contain">
								{permittedServices.map((svc) => {
									const group = svc.group
										? groupById.get(svc.group)
										: undefined;
									return (
										<div
											key={svc.id}
											className="flex items-center gap-2.5 rounded-lg bg-bg-weak-50 px-3 py-2.5 transition-colors hover:bg-bg-soft-200"
										>
											<span
												className="size-2 shrink-0 rounded-full"
												style={{
													backgroundColor:
														group?.color ?? "#a3a3a3",
												}}
											/>
											<span className="min-w-0 flex-1 truncate text-sm font-medium text-text-strong-950">
												{svc.name}
											</span>
										</div>
									);
								})}
							</div>
						) : (
							<div className="flex items-center gap-3 rounded-lg bg-bg-weak-50 px-4 py-3">
								<div className="rounded-lg bg-bg-white-0 p-2">
									<RiServerLine className="size-4 text-text-soft-400" />
								</div>
								<p className="text-sm text-text-sub-600">
									暂未分配服务，请联系管理员开通
								</p>
							</div>
						)}
					</div>
				)}
			</PageCard>

			<PageCard title="访问令牌" description="到期前可刷新以延长当前会话">
				<div className="flex items-center justify-between rounded-lg bg-bg-weak-50 px-4 py-3">
					<div className="flex items-center gap-3">
						<div className="rounded-lg bg-bg-white-0 p-2">
							<RiKeyLine className="size-4 text-primary-base" />
						</div>
						<div>
							<p className="text-sm font-medium text-text-strong-950">
								剩余有效期
							</p>
							<p className="text-xs text-text-sub-600">
								{getTokenExpiry()}
							</p>
						</div>
					</div>
					<Button.Root
						size="xsmall"
						variant="neutral"
						mode="stroke"
						onClick={onRefreshToken}
						disabled={refreshing}
					>
						{refreshing ? (
							<>
								<RiRefreshLine className="size-3.5 animate-spin" />
								处理中...
							</>
						) : (
							<>
								<RiRefreshLine className="size-3.5" />
								刷新
							</>
						)}
					</Button.Root>
				</div>
			</PageCard>
		</div>
	);
}