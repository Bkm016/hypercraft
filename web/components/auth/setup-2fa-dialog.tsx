"use client";

import { useState } from "react";
import { useQRCode } from "next-qrcode";
import { RiCloseLine, RiCheckLine, RiFileCopyLine, RiShieldKeyholeLine } from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as CompactButton from "@/components/ui/compact-button";

interface Setup2FADialogProps {
  secret: string;
  qrUri: string;
  recoveryCodes: string[];
  onConfirm: (code: string) => Promise<void>;
  onClose: () => void;
}

export function Setup2FADialog({
  secret,
  qrUri,
  recoveryCodes,
  onConfirm,
  onClose,
}: Setup2FADialogProps) {
  const { Canvas } = useQRCode();
  const [totpCode, setTotpCode] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedRecovery, setCopiedRecovery] = useState(false);

  const handleConfirm = async () => {
    if (!totpCode || totpCode.length !== 6) {
      setError("请输入 6 位验证码");
      return;
    }

    setError("");
    setConfirming(true);
    try {
      await onConfirm(totpCode);
    } catch (err: unknown) {
      const apiError = err as { message?: string };
      setError(apiError.message || "启用 2FA 失败");
    } finally {
      setConfirming(false);
    }
  };

  const copyToClipboard = async (text: string, type: "secret" | "recovery") => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === "secret") {
        setCopiedSecret(true);
        setTimeout(() => setCopiedSecret(false), 2000);
      } else {
        setCopiedRecovery(true);
        setTimeout(() => setCopiedRecovery(false), 2000);
      }
    } catch {
      // 复制失败
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-stroke-soft-200 bg-bg-white-0 shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stroke-soft-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-text-strong-950">启用双因素认证</h2>
          <CompactButton.Root variant="ghost" onClick={onClose}>
            <CompactButton.Icon as={RiCloseLine} />
          </CompactButton.Root>
        </div>

        {/* Content */}
        <div className="space-y-6 px-6 py-6">
          {/* Step 1: Scan QR Code */}
          <div>
            <h3 className="mb-3 text-sm font-medium text-text-strong-950">
              1. 使用 Google Authenticator 扫描二维码
            </h3>
            <div className="flex justify-center rounded-lg bg-bg-weak-50 p-4">
              <Canvas
                text={qrUri}
                options={{
                  errorCorrectionLevel: "M",
                  margin: 2,
                  scale: 4,
                  width: 200,
                }}
              />
            </div>
            <div className="mt-3 rounded-lg bg-bg-weak-50 p-3">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-xs text-text-sub-600">或手动输入密钥：</p>
                  <code className="mt-1 block break-all font-mono text-xs text-text-strong-950">
                    {secret}
                  </code>
                </div>
                <CompactButton.Root
                  variant="ghost"
                  onClick={() => copyToClipboard(secret, "secret")}
                  className="ml-2 shrink-0"
                >
                  <CompactButton.Icon as={copiedSecret ? RiCheckLine : RiFileCopyLine} />
                </CompactButton.Root>
              </div>
            </div>
          </div>

          {/* Step 2: Save Recovery Codes */}
          <div>
            <h3 className="mb-3 text-sm font-medium text-text-strong-950">
              2. 保存恢复码（请妥善保管）
            </h3>
            <div className="rounded-lg border border-stroke-soft-200 bg-bg-weak-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs text-text-sub-600">恢复码可用于在丢失验证器时恢复账号</p>
                <CompactButton.Root
                  variant="ghost"
                  onClick={() => copyToClipboard(recoveryCodes.join("\n"), "recovery")}
                >
                  <CompactButton.Icon as={copiedRecovery ? RiCheckLine : RiFileCopyLine} />
                </CompactButton.Root>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {recoveryCodes.map((code, i) => (
                  <code
                    key={i}
                    className="rounded bg-bg-white-0 px-2 py-1.5 text-center font-mono text-xs text-text-strong-950"
                  >
                    {code}
                  </code>
                ))}
              </div>
            </div>
          </div>

          {/* Step 3: Verify */}
          <div>
            <h3 className="mb-3 text-sm font-medium text-text-strong-950">
              3. 输入 6 位验证码确认
            </h3>
            <div className="relative">
              <RiShieldKeyholeLine className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-soft-400" />
              <input
                type="text"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="输入 6 位验证码"
                maxLength={6}
                className="h-10 w-full rounded-lg border border-stroke-soft-200 bg-bg-white-0 pl-10 pr-3 text-sm text-text-strong-950 placeholder:text-text-soft-400 focus:border-primary-base focus:outline-none focus:ring-2 focus:ring-primary-alpha-10"
              />
            </div>
            {error && (
              <p className="mt-2 text-xs text-error-base">{error}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-stroke-soft-200 px-6 py-4">
          <Button.Root size="small" variant="neutral" mode="stroke" onClick={onClose}>
            取消
          </Button.Root>
          <Button.Root
            size="small"
            onClick={handleConfirm}
            disabled={confirming || totpCode.length !== 6}
          >
            {confirming ? "启用中..." : "确认启用"}
          </Button.Root>
        </div>
      </div>
    </div>
  );
}
