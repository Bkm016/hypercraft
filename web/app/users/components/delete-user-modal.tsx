"use client";

import { useState } from "react";
import { RiErrorWarningLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import type { UserSummary } from "@/lib/api";

export interface DeleteUserModalProps {
  user: UserSummary;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteUserModal({
  user,
  onClose,
  onConfirm,
}: DeleteUserModalProps) {
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
            title="确认删除用户"
            description={`即将删除用户「${user.username}」`}
          />
          <FormDialog.Body>
            <FormDialog.Error message="此操作将永久删除用户账户。" />
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
