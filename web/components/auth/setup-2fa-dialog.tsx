"use client";

import { useState } from "react";
import { useQRCode } from "next-qrcode";
import { RiCheckLine, RiFileCopyLine, RiShieldKeyholeLine, RiArrowLeftLine, RiArrowRightLine } from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as CompactButton from "@/components/ui/compact-button";
import * as FormDialog from "@/components/ui/form-dialog";

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
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [totpCode, setTotpCode] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedRecovery, setCopiedRecovery] = useState(false);

  const handleNext = () => {
    if (step < 3) {
      setStep((s) => (s + 1) as 1 | 2 | 3);
      setError("");
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep((s) => (s - 1) as 1 | 2 | 3);
      setError("");
    }
  };

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

  const getStepTitle = () => {
    switch (step) {
      case 1:
        return "扫描二维码";
      case 2:
        return "保存恢复码";
      case 3:
        return "验证并启用";
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
    <FormDialog.Root open={true} onOpenChange={(open) => !open && onClose()} size="md">
      <FormDialog.Content>
        <FormDialog.Header title={`启用双因素认证 (${step}/3)`} description={getStepTitle()} />

        <FormDialog.Body>
          {/* Step Indicator */}
          <div className="flex items-center justify-center gap-2 pb-4">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-2 flex-1 rounded-full transition-colors ${
                  s === step
                    ? "bg-primary-base"
                    : s < step
                      ? "bg-success-base"
                      : "bg-stroke-soft-200"
                }`}
              />
            ))}
          </div>

          {/* Step 1: Scan QR Code */}
          {step === 1 && (
            <div className="min-h-[380px] space-y-4">
              <div>
                <p className="mb-3 text-sm text-text-sub-600">
                  使用 Google Authenticator 或其他 TOTP 应用扫描二维码
                </p>
                <div className="flex justify-center rounded-lg bg-bg-weak-50 p-6">
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
              </div>
              <div className="rounded-lg border border-stroke-soft-200 bg-bg-weak-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-text-sub-600">或手动输入密钥</p>
                    <code className="mt-1 block break-all font-mono text-xs text-text-strong-950">
                      {secret}
                    </code>
                  </div>
                  <CompactButton.Root
                    variant="ghost"
                    onClick={() => copyToClipboard(secret, "secret")}
                    className="shrink-0"
                  >
                    <CompactButton.Icon as={copiedSecret ? RiCheckLine : RiFileCopyLine} />
                  </CompactButton.Root>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Save Recovery Codes */}
          {step === 2 && (
            <div className="min-h-[380px] space-y-4">
              <div className="rounded-lg border border-away-light bg-away-lighter p-4">
                <p className="text-sm font-medium text-away-dark">⚠️ 重要提示</p>
                <p className="mt-1 text-xs text-away-dark">
                  恢复码可用于在丢失验证器时恢复账号，请妥善保管，每个恢复码只能使用一次
                </p>
              </div>
              <div className="rounded-lg border border-stroke-soft-200 bg-bg-weak-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-text-strong-950">恢复码</p>
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
                      className="rounded bg-bg-white-0 px-3 py-2 text-center font-mono text-xs text-text-strong-950"
                    >
                      {code}
                    </code>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Verify */}
          {step === 3 && (
            <div className="min-h-[380px] space-y-4">
              <p className="text-sm text-text-sub-600">
                从验证器应用中输入 6 位验证码以完成设置
              </p>
              <div>
                <label className="mb-2 block text-sm font-medium text-text-strong-950">
                  验证码
                </label>
                <div className="relative">
                  <RiShieldKeyholeLine className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-soft-400" />
                  <input
                    type="text"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="输入 6 位验证码"
                    maxLength={6}
                    autoFocus
                    className="h-10 w-full rounded-lg border border-stroke-soft-200 bg-bg-white-0 pl-10 pr-3 text-sm text-text-strong-950 placeholder:text-text-soft-400 focus:border-primary-base focus:outline-none focus:ring-2 focus:ring-primary-alpha-10"
                  />
                </div>
                {error && (
                  <p className="mt-2 text-xs text-error-base">{error}</p>
                )}
              </div>
            </div>
          )}
        </FormDialog.Body>

        <FormDialog.Footer>
          <div className="flex w-full items-center justify-between">
            <Button.Root
              size="small"
              variant="neutral"
              mode="stroke"
              onClick={step === 1 ? onClose : handleBack}
              type="button"
            >
              {step === 1 ? (
                "取消"
              ) : (
                <>
                  <RiArrowLeftLine className="size-4" />
                  上一步
                </>
              )}
            </Button.Root>
            {step < 3 ? (
              <Button.Root size="small" onClick={handleNext}>
                下一步
                <RiArrowRightLine className="size-4" />
              </Button.Root>
            ) : (
              <Button.Root
                size="small"
                onClick={handleConfirm}
                disabled={!totpCode || totpCode.length !== 6 || confirming}
              >
                {confirming ? "验证中..." : "确认启用"}
              </Button.Root>
            )}
          </div>
        </FormDialog.Footer>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
