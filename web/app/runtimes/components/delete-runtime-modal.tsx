"use client";

import { useState } from "react";
import { RiErrorWarningLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import type { Runtime } from "@/lib/api";

export interface DeleteRuntimeModalProps {
  runtime: Runtime;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteRuntimeModal({ runtime, onClose, onConfirm }: DeleteRuntimeModalProps) {
  const [loading, setLoading] = useState(false);
  const inUse = runtime.used_by.length > 0;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <FormDialog.Content>
        <div>
          <FormDialog.Header
            icon={RiErrorWarningLine}
            iconClassName="text-error-base"
            title="删除运行环境"
            description={`即将删除「${runtime.name}」`}
          />
          <FormDialog.Body>
            <FormDialog.Error
              message={
                inUse
                  ? `仍有服务在使用：${runtime.used_by.join(", ")}。请先在这些服务中改用其他运行环境。`
                  : runtime.source === "managed"
                    ? "将同时删除已下载的文件，需要时可重新安装。"
                    : "仅删除登记，不会删除服务器上的目录。"
              }
            />
          </FormDialog.Body>
          <FormDialog.Footer>
            <FormDialog.Button variant="secondary" onClick={onClose}>
              取消
            </FormDialog.Button>
            <FormDialog.Button variant="danger" loading={loading} disabled={inUse} onClick={handleConfirm}>
              确认删除
            </FormDialog.Button>
          </FormDialog.Footer>
        </div>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
