"use client";

import { RiErrorWarningLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";

export interface ControlConfirmModalProps {
  keyName: string;
  actionLabel: string;
  /** 路径参数目标（服务 id 或分组 id） */
  targetLabel: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ControlConfirmModal({
  keyName,
  actionLabel,
  targetLabel,
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
              message={`将对「${targetLabel}」执行 ${actionLabel}，请确认影响范围后再继续。`}
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
