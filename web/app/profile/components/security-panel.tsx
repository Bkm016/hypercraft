"use client";

import { useState } from "react";
import { RiShieldCheckLine, RiShieldLine } from "@remixicon/react";
import * as Button from "@/components/ui/button";
import { PageCard } from "@/components/layout/page-layout";
import { api, type Setup2FAResponse } from "@/lib/api";
import { Setup2FADialog } from "@/components/auth/setup-2fa-dialog";
import { VerificationCodeDialog } from "@/components/auth/verification-code-dialog";

interface SecurityPanelProps {
	twoFactorEnabled: boolean;
	onTwoFactorChange: () => void;
}

export function SecurityPanel({
	twoFactorEnabled,
	onTwoFactorChange,
}: SecurityPanelProps) {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");

	// 2FA 设置状态
	const [showSetup2FA, setShowSetup2FA] = useState(false);
	const [setup2FAData, setSetup2FAData] = useState<Setup2FAResponse | null>(
		null,
	);
	const [showVerificationDialog, setShowVerificationDialog] = useState(false);

	// 启用 2FA - 第一步：获取 QR 码和恢复码
	const handleEnable2FAStart = async () => {
		setError("");
		setSuccess("");
		setLoading(true);

		try {
			const response = await api.setup2FA({});
			setSetup2FAData(response);
			setShowSetup2FA(true);
		} catch (err: unknown) {
			const error = err as { message?: string };
			setError(error.message || "获取 2FA 配置失败");
		} finally {
			setLoading(false);
		}
	};

	// 启用 2FA - 第二步：验证并启用
	const handleEnable2FAConfirm = async (code: string) => {
		if (!setup2FAData) return;

		setLoading(true);
		try {
			await api.enable2FA({
				totp_code: code,
				secret: setup2FAData.secret,
				recovery_codes: setup2FAData.recovery_codes,
			});

			setShowSetup2FA(false);
			setSetup2FAData(null);
			setSuccess("双因素认证已启用");
			onTwoFactorChange();
		} catch (err: unknown) {
			const error = err as { message?: string };
			throw new Error(error.message || "启用 2FA 失败");
		} finally {
			setLoading(false);
		}
	};

	// 禁用 2FA
	const handleDisable2FA = () => {
		setError("");
		setSuccess("");
		setShowVerificationDialog(true);
	};

	// 禁用 2FA - 验证码确认
	const handleDisableVerificationConfirm = async (code: string) => {
		setShowVerificationDialog(false);
		setLoading(true);

		try {
			const verification = code.includes("-")
				? { type: "recovery" as const, code }
				: { type: "totp" as const, code };

			await api.disable2FA({ verification });

			setSuccess("双因素认证已禁用");
			onTwoFactorChange();
		} catch (err: unknown) {
			const error = err as { message?: string };
			setError(error.message || "禁用 2FA 失败");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="space-y-6">
			<PageCard title="双因素认证" description="为你的账号添加额外的安全保护">
				{error && (
					<div className="mb-4 rounded-lg bg-error-lighter px-4 py-3 text-sm text-error-base">
						{error}
					</div>
				)}
				{success && (
					<div className="mb-4 rounded-lg bg-success-lighter px-4 py-3 text-sm text-success-base">
						{success}
					</div>
				)}

				<div className="flex items-center justify-between rounded-lg bg-bg-weak-50 px-4 py-3">
					<div className="flex items-center gap-3">
						<div
							className={`rounded-lg p-2 ${twoFactorEnabled ? "bg-success-alpha-10" : "bg-bg-white-0"}`}
						>
							{twoFactorEnabled ? (
								<RiShieldCheckLine className="size-4 text-success-base" />
							) : (
								<RiShieldLine className="size-4 text-text-soft-400" />
							)}
						</div>
						<div>
							<p className="text-sm font-medium text-text-strong-950">
								{twoFactorEnabled ? "已启用" : "未启用"}
							</p>
							<p className="text-xs text-text-sub-600">
								{twoFactorEnabled
									? "使用 TOTP 应用进行双因素认证"
									: "推荐启用以提升账号安全性"}
							</p>
						</div>
					</div>
					{twoFactorEnabled ? (
						<Button.Root
							size="xsmall"
							variant="error"
							mode="stroke"
							onClick={handleDisable2FA}
							disabled={loading}
						>
							{loading ? "处理中..." : "禁用"}
						</Button.Root>
					) : (
						<Button.Root
							size="xsmall"
							variant="neutral"
							mode="stroke"
							onClick={handleEnable2FAStart}
							disabled={loading}
						>
							{loading ? "处理中..." : "启用"}
						</Button.Root>
					)}
				</div>
			</PageCard>

			{/* 2FA 设置对话框 */}
			{showSetup2FA && setup2FAData && (
				<Setup2FADialog
					secret={setup2FAData.secret}
					qrUri={setup2FAData.qr_uri}
					recoveryCodes={setup2FAData.recovery_codes}
					onConfirm={handleEnable2FAConfirm}
					onClose={() => {
						setShowSetup2FA(false);
						setSetup2FAData(null);
					}}
				/>
			)}

			{/* 验证码确认对话框 */}
			{showVerificationDialog && (
				<VerificationCodeDialog
					title="禁用双因素认证"
					description="请输入 6 位验证码或恢复码以确认禁用"
					onConfirm={handleDisableVerificationConfirm}
					onClose={() => setShowVerificationDialog(false)}
				/>
			)}
		</div>
	);
}

function SecurityTip({
	title,
	description,
	active = false,
}: {
	title: string;
	description: string;
	active?: boolean;
}) {
	return (
		<div
			className={`rounded-lg border px-4 py-3 ${
				active
					? "border-success-light bg-success-lighter"
					: "border-stroke-soft-200 bg-bg-white-0"
			}`}
		>
			<div className="flex items-center gap-2">
				{active && (
					<RiShieldCheckLine className="size-4 shrink-0 text-success-base" />
				)}
				<p
					className={`text-sm font-medium ${active ? "text-success-base" : "text-text-strong-950"}`}
				>
					{title}
				</p>
			</div>
			<p
				className={`mt-0.5 text-xs ${active ? "text-success-base/80" : "text-text-sub-600"}`}
			>
				{description}
			</p>
		</div>
	);
}
