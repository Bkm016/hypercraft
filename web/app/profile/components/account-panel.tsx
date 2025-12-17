"use client";

import {
	RiKeyLine,
	RiRefreshLine,
	RiServerLine,
	RiTimeLine,
	RiUserLine,
} from "@remixicon/react";
import * as Button from "@/components/ui/button";
import { PageCard } from "@/components/layout/page-layout";
import type { TokenClaims, ServiceSummary } from "@/lib/api";

interface AccountPanelProps {
	user: TokenClaims;
	isAdmin: boolean;
	services: ServiceSummary[];
	refreshing: boolean;
	onRefreshToken: () => void;
}

export function AccountPanel({
	user,
	isAdmin,
	services,
	refreshing,
	onRefreshToken,
}: AccountPanelProps) {
	// 计算 token 过期时间
	const getTokenExpiry = () => {
		const expiryTime = user.exp * 1000;
		const now = Date.now();
		const diff = expiryTime - now;

		if (diff <= 0) return "已过期";

		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(minutes / 60);

		if (hours > 0) {
			return `${hours} 小时 ${minutes % 60} 分钟后`;
		}
		return `${minutes} 分钟后`;
	};

	// 获取用户有权限的服务名称
	const getUserServices = () => {
		if (!user?.service_ids) return [];
		return user.service_ids.map((id) => {
			const service = services.find((s) => s.id === id);
			return service?.name || id;
		});
	};

	// 格式化时间
	const formatDate = (timestamp: number) => {
		return new Date(timestamp * 1000).toLocaleString("zh-CN");
	};

	return (
		<div className="space-y-6">
			{/* 账号信息 */}
			<PageCard title="账号信息" description="你的基本账号信息">
				<div className="space-y-4">
					<InfoRow
						icon={<RiUserLine className="size-4" />}
						label="用户名"
						value={user.username}
					/>
					<InfoRow
						icon={<RiUserLine className="size-4" />}
						label="用户 ID"
						value={
							<code className="rounded bg-bg-weak-50 px-1.5 py-0.5 text-xs">
								{user.sub}
							</code>
						}
					/>
					<InfoRow
						icon={<RiUserLine className="size-4" />}
						label="角色"
						value={
							<span
								className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
									isAdmin
										? "bg-away-lighter text-away-base"
										: "bg-bg-weak-50 text-text-sub-600"
								}`}
							>
								{isAdmin ? "管理员" : "用户"}
							</span>
						}
					/>
					{!isAdmin && (
						<InfoRow
							icon={<RiServerLine className="size-4" />}
							label="服务权限"
							value={
								<div className="flex flex-wrap gap-1.5">
									{getUserServices().length > 0 ? (
										getUserServices().map((name) => (
											<span
												key={name}
												className="rounded bg-bg-weak-50 px-2 py-0.5 text-xs text-text-sub-600"
											>
												{name}
											</span>
										))
									) : (
										<span className="text-text-soft-400">无服务权限</span>
									)}
								</div>
							}
						/>
					)}
					<InfoRow
						icon={<RiTimeLine className="size-4" />}
						label="Token 签发时间"
						value={formatDate(user.iat)}
					/>
				</div>
			</PageCard>

			{/* Token 状态 */}
			<PageCard title="Token 状态" description="访问令牌的有效期信息">
				<div className="flex items-center justify-between rounded-lg bg-bg-weak-50 px-4 py-3">
					<div className="flex items-center gap-3">
						<div className="rounded-lg bg-primary-alpha-10 p-2">
							<RiKeyLine className="size-4 text-primary-base" />
						</div>
						<div>
							<p className="text-sm font-medium text-text-strong-950">
								访问令牌
							</p>
							<p className="text-xs text-text-sub-600">
								将在{" "}
								<span className="font-medium text-away-base">
									{getTokenExpiry()}
								</span>{" "}
								过期
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
								刷新中...
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

function InfoRow({
	icon,
	label,
	value,
}: {
	icon: React.ReactNode;
	label: string;
	value: React.ReactNode;
}) {
	return (
		<div className="flex items-center justify-between border-b border-stroke-soft-200 pb-4 last:border-0 last:pb-0">
			<div className="flex items-center gap-2 text-text-sub-600">
				{icon}
				<span className="text-sm">{label}</span>
			</div>
			<div className="text-sm text-text-strong-950">{value}</div>
		</div>
	);
}
