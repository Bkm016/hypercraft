"use client";

import { useState } from "react";
import { RiShieldKeyholeLine } from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as FormDialog from "@/components/ui/form-dialog";

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
    <FormDialog.Root open={true} onOpenChange={(open) => !open && onClose()} size="sm">
      <FormDialog.Content>
        <FormDialog.Header title={title} description={description} />

        <form onSubmit={handleSubmit}>
          <FormDialog.Body>
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
          </FormDialog.Body>

          <FormDialog.Footer>
            <Button.Root size="small" variant="neutral" mode="stroke" onClick={onClose} type="button">
              取消
            </Button.Root>
            <Button.Root size="small" type="submit" disabled={!code.trim()}>
              确认
            </Button.Root>
          </FormDialog.Footer>
        </form>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
