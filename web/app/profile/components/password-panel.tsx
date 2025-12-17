"use client";

import { useState } from "react";
import { RiCheckLine, RiEyeLine, RiEyeOffLine } from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as CompactButton from "@/components/ui/compact-button";
import { PageCard } from "@/components/layout/page-layout";
import { api } from "@/lib/api";

interface PasswordPanelProps {
	userId: string;
	isAdmin: boolean;
}

export function PasswordPanel({ userId, isAdmin }: PasswordPanelProps) {
	const [showCurrentPassword, setShowCurrentPassword] = useState(false);
	const [showNewPassword, setShowNewPassword] = useState(false);
	const [saving, setSaving] = useState(false);

	// 密码表单
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setSuccess("");

		if (newPassword !== confirmPassword) {
			setError("两次输入的密码不一致");
			return;
		}

		if (newPassword.length < 4) {
			setError("新密码长度至少 4 位");
			return;
		}

		setSaving(true);
		try {
			await api.changePassword(userId, {
				new_password: newPassword,
				current_password: currentPassword || undefined,
			});
			setSuccess("密码修改成功");
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
		} catch (err: unknown) {
			const error = err as { message?: string };
			setError(error.message || "修改密码失败");
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="space-y-6">
			<PageCard title="修改密码" description="更新你的登录密码">
				<form onSubmit={handleSubmit} className="space-y-4">
					{error && (
						<div className="rounded-lg bg-error-lighter px-4 py-3 text-sm text-error-base">
							{error}
						</div>
					)}
					{success && (
						<div className="rounded-lg bg-success-lighter px-4 py-3 text-sm text-success-base">
							{success}
						</div>
					)}

					{!isAdmin && (
						<div>
							<label className="mb-1.5 block text-sm font-medium text-text-strong-950">
								当前密码
							</label>
							<div className="relative">
								<input
									type={showCurrentPassword ? "text" : "password"}
									placeholder="输入当前密码"
									value={currentPassword}
									onChange={(e) => setCurrentPassword(e.target.value)}
									className="h-10 w-full rounded-lg border border-stroke-soft-200 bg-bg-white-0 px-3 pr-10 text-sm text-text-strong-950 placeholder:text-text-soft-400 focus:border-primary-base focus:outline-none focus:ring-2 focus:ring-primary-alpha-10"
								/>
								<CompactButton.Root
									type="button"
									variant="ghost"
									onClick={() => setShowCurrentPassword(!showCurrentPassword)}
									className="absolute right-1 top-1/2 -translate-y-1/2"
								>
									<CompactButton.Icon
										as={showCurrentPassword ? RiEyeOffLine : RiEyeLine}
									/>
								</CompactButton.Root>
							</div>
						</div>
					)}

					<div>
						<label className="mb-1.5 block text-sm font-medium text-text-strong-950">
							新密码
						</label>
						<div className="relative">
							<input
								type={showNewPassword ? "text" : "password"}
								placeholder="输入新密码"
								value={newPassword}
								onChange={(e) => setNewPassword(e.target.value)}
								className="h-10 w-full rounded-lg border border-stroke-soft-200 bg-bg-white-0 px-3 pr-10 text-sm text-text-strong-950 placeholder:text-text-soft-400 focus:border-primary-base focus:outline-none focus:ring-2 focus:ring-primary-alpha-10"
							/>
							<CompactButton.Root
								type="button"
								variant="ghost"
								onClick={() => setShowNewPassword(!showNewPassword)}
								className="absolute right-1 top-1/2 -translate-y-1/2"
							>
								<CompactButton.Icon
									as={showNewPassword ? RiEyeOffLine : RiEyeLine}
								/>
							</CompactButton.Root>
						</div>
					</div>

					<div>
						<label className="mb-1.5 block text-sm font-medium text-text-strong-950">
							确认新密码
						</label>
						<input
							type="password"
							placeholder="再次输入新密码"
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							className="h-10 w-full rounded-lg border border-stroke-soft-200 bg-bg-white-0 px-3 text-sm text-text-strong-950 placeholder:text-text-soft-400 focus:border-primary-base focus:outline-none focus:ring-2 focus:ring-primary-alpha-10"
						/>
					</div>

					<Button.Root type="submit" size="small" disabled={saving || !newPassword}>
						{saving ? (
							"保存中..."
						) : (
							<>
								<Button.Icon as={RiCheckLine} />
								保存密码
							</>
						)}
					</Button.Root>
				</form>
			</PageCard>
		</div>
	);
}

function PasswordTip({ text }: { text: string }) {
	return (
		<div className="flex items-center gap-2">
			<div className="size-1.5 shrink-0 rounded-full bg-primary-base" />
			<span>{text}</span>
		</div>
	);
}
