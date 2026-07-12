"use client";

import { RiErrorWarningLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";

export interface ControlConfirmModalProps {
  keyName: string;
  actionLabel: string;
  serviceId: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ControlConfirmModal({
  keyName,
  actionLabel,
  serviceId,
  loading,
  onClose,
  onConfirm,
}: ControlConfirmModalProps) {
  return (
    <FormDialog.Root
      open
      size="sm"
      onOpenChange={(open) => !open && !loading && onClose()}
    >
      <FormDialog.Content>
        <div>
          <FormDialog.Header
            icon={RiErrorWarningLine}
            iconClassName="text-error-base"
            title="确认执行"
            description={`Key「${keyName}」→ ${actionLabel}`}
          />
          <FormDialog.Body>
            <FormDialog.Error
              message={`将对服务「${serviceId}」执行 ${actionLabel}，此操作会影响线上进程。`}
            />
          </FormDialog.Body>
          <FormDialog.Footer>
            <FormDialog.Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={onClose}
            >
              取消
            </FormDialog.Button>
            <FormDialog.Button
              type="button"
              variant="danger"
              loading={loading}
              onClick={onConfirm}
            >
              确认执行
            </FormDialog.Button>
          </FormDialog.Footer>
        </div>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
