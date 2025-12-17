"use client";

import {
	RiKeyLine,
	RiLogoutBoxLine,
	RiShieldLine,
	RiUserLine,
} from "@remixicon/react";

export type ProfileSection = "account" | "security" | "password";

interface ProfileSidebarProps {
	activeSection: ProfileSection;
	onSectionChange: (section: ProfileSection) => void;
	onLogout: () => void;
	isDevToken?: boolean;
}

export function ProfileSidebar({
	activeSection,
	onSectionChange,
	onLogout,
	isDevToken = false,
}: ProfileSidebarProps) {
	const navItems = [
		{ id: "account" as const, icon: RiUserLine, label: "账号信息" },
		{ id: "security" as const, icon: RiShieldLine, label: "安全设置" },
		...(!isDevToken
			? [{ id: "password" as const, icon: RiKeyLine, label: "修改密码" }]
			: []),
	];

	return (
		<nav className="w-full space-y-0.5 lg:w-48 lg:shrink-0">
			{/* 导航项 */}
			{navItems.map((item) => {
				const Icon = item.icon;
				const isActive = activeSection === item.id;

				return (
					<button
						key={item.id}
						type="button"
						onClick={() => onSectionChange(item.id)}
						className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors duration-150 ${
							isActive
								? "bg-bg-weak-50 text-text-strong-950 font-medium"
								: "text-text-sub-600 hover:bg-bg-weak-50 hover:text-text-strong-950"
						}`}
					>
						<Icon className="size-4 shrink-0" />
						<span className="truncate">{item.label}</span>
					</button>
				);
			})}

			{/* 分隔线 */}
			<div className="mt-3! mb-3 border-t border-stroke-soft-200" />

			{/* 退出登录按钮 */}
			<button
				type="button"
				onClick={onLogout}
				className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-error-base outline-none transition-colors duration-150 hover:bg-error-lighter hover:text-error-dark"
			>
				<RiLogoutBoxLine className="size-4 shrink-0" />
				<span className="truncate">退出登录</span>
			</button>
		</nav>
	);
}
