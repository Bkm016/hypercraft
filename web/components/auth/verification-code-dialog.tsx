"use client";

import { useState } from "react";
import { RiCloseLine, RiShieldKeyholeLine } from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as CompactButton from "@/components/ui/compact-button";

interface VerificationCodeDialogProps {
  title: string;
  description: string;
  onConfirm: (code: string) => void;
  onClose: () => void;
}

export function VerificationCodeDialog({
  title,
  description,
  onConfirm,
  onClose,
}: VerificationCodeDialogProps) {
  const [code, setCode] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim()) {
      onConfirm(code);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-stroke-soft-200 bg-bg-white-0 shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stroke-soft-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-text-strong-950">{title}</h2>
          <CompactButton.Root variant="ghost" onClick={onClose}>
            <CompactButton.Icon as={RiCloseLine} />
          </CompactButton.Root>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-6 py-6">
            <p className="text-sm text-text-sub-600">{description}</p>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-strong-950">
                验证码
              </label>
              <div className="relative">
                <RiShieldKeyholeLine className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-soft-400" />
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="输入 6 位验证码或恢复码"
                  autoFocus
                  className="h-10 w-full rounded-lg border border-stroke-soft-200 bg-bg-white-0 pl-10 pr-3 text-sm text-text-strong-950 placeholder:text-text-soft-400 focus:border-primary-base focus:outline-none focus:ring-2 focus:ring-primary-alpha-10"
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 border-t border-stroke-soft-200 px-6 py-4">
            <Button.Root size="small" variant="neutral" mode="stroke" onClick={onClose} type="button">
              取消
            </Button.Root>
            <Button.Root size="small" type="submit" disabled={!code.trim()}>
              确认
            </Button.Root>
          </div>
        </form>
      </div>
    </div>
  );
}
