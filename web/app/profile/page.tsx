"use client";

import { useState, useEffect } from "react";
import {
	PageLayout,
	PageHeader,
	PageContent,
} from "@/components/layout/page-layout";
import { useAuth } from "@/lib/auth";
import { api, type ServiceSummary } from "@/lib/api";
import {
	ProfileSidebar,
	AccountPanel,
	SecurityPanel,
	PasswordPanel,
	type ProfileSection,
} from "./components";

export default function ProfilePage() {
	const { user, isAdmin, logout, isAuthenticated } = useAuth();
	const [activeSection, setActiveSection] = useState<ProfileSection>("account");
	const [refreshing, setRefreshing] = useState(false);

	// 2FA 状态
	const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

	// 服务列表（用于显示服务名称）
	const [services, setServices] = useState<ServiceSummary[]>([]);

	// 判断是否是 DevToken 用户（没有密码可改）
	const isDevToken = user?.sub === "dev" || user?.token_type === "dev";

	useEffect(() => {
		if (isAuthenticated) {
			loadServices();
			loadTwoFactorStatus();
		}
	}, [isAuthenticated]);

	const loadServices = async () => {
		try {
			const data = await api.listServices();
			setServices(data);
		} catch {
			// 忽略错误
		}
	};

	const loadTwoFactorStatus = async () => {
		if (!user) return;

		try {
			const userData = await api.getMe();
			setTwoFactorEnabled(userData.totp_enabled);
		} catch (err) {
			console.error("Failed to load 2FA status:", err);
			setTwoFactorEnabled(false);
		}
	};

	const handleRefreshToken = async () => {
		setRefreshing(true);
		try {
			const refreshToken = api.getRefreshToken();
			if (refreshToken) {
				await api.authRefresh({ refresh_token: refreshToken });
				// 刷新页面以更新状态
				window.location.reload();
			}
		} catch {
			// 刷新失败，可能需要重新登录
		} finally {
			setRefreshing(false);
		}
	};

	// 获取当前面板的标题和描述
	const getPanelInfo = () => {
		switch (activeSection) {
			case "account":
				return {
					title: "账号信息",
					description: "查看和管理你的基本账号信息",
				};
			case "security":
				return {
					title: "安全设置",
					description: "管理双因素认证和账号安全选项",
				};
			case "password":
				return {
					title: "修改密码",
					description: "更新你的登录密码",
				};
		}
	};

	if (!user) {
		return (
			<PageLayout>
				<PageContent>
					<div className="flex items-center justify-center py-20">
						<p className="text-text-sub-600">加载中...</p>
					</div>
				</PageContent>
			</PageLayout>
		);
	}

	const panelInfo = getPanelInfo();

	return (
		<PageLayout>
			<PageHeader title="个人中心" description="管理你的账号信息和安全设置" />

			<PageContent maxWidth="6xl">
				<div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
					{/* 左侧导航 */}
					<ProfileSidebar
						activeSection={activeSection}
						onSectionChange={setActiveSection}
						onLogout={logout}
						isDevToken={isDevToken}
					/>

					{/* 右侧内容区 */}
					<div className="min-w-0 flex-1">
						{/* 面板标题 */}
						<div className="mb-6 border-b border-stroke-soft-200 pb-4">
							<h2 className="text-lg font-semibold text-text-strong-950">
								{panelInfo.title}
							</h2>
							<p className="mt-1 text-sm text-text-sub-600">
								{panelInfo.description}
							</p>
						</div>

						{/* 内容面板 */}
						{activeSection === "account" && (
							<AccountPanel
								user={user}
								isAdmin={isAdmin}
								services={services}
								refreshing={refreshing}
								onRefreshToken={handleRefreshToken}
							/>
						)}

						{activeSection === "security" && (
							<SecurityPanel
								twoFactorEnabled={twoFactorEnabled}
								onTwoFactorChange={loadTwoFactorStatus}
							/>
						)}

						{activeSection === "password" && !isDevToken && (
							<PasswordPanel userId={user.sub} isAdmin={isAdmin} />
						)}
					</div>
				</div>
			</PageContent>
		</PageLayout>
	);
}
