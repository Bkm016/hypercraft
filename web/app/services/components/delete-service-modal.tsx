"use client";

import { useState } from "react";
import { RiErrorWarningLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";

export interface DeleteServiceModalProps {
  serviceName: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteServiceModal({
  serviceName,
  onClose,
  onConfirm,
}: DeleteServiceModalProps) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    await onConfirm();
    setLoading(false);
  };

  return (
    <FormDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <FormDialog.Content>
        <div>
          <FormDialog.Header
            icon={RiErrorWarningLine}
            iconClassName="text-error-base"
            title="确认删除服务"
            description={`即将删除服务「${serviceName}」`}
          />
          <FormDialog.Body>
            <FormDialog.Error message="此操作将永久删除服务的所有配置和日志。" />
          </FormDialog.Body>
          <FormDialog.Footer>
            <FormDialog.Button variant="secondary" onClick={onClose}>
              取消
            </FormDialog.Button>
            <FormDialog.Button variant="danger" loading={loading} onClick={handleConfirm}>
              确认删除
            </FormDialog.Button>
          </FormDialog.Footer>
        </div>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
