"use client";

import { useState } from "react";
import { RiErrorWarningLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import { api } from "@/lib/api";
import { notification } from "@/hooks/use-notification";

export interface DeleteGroupModalProps {
  open: boolean;
  groupId: string;
  groupName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function DeleteGroupModal({
  open,
  groupId,
  groupName,
  onClose,
  onSuccess,
}: DeleteGroupModalProps) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteGroup(groupId);
      notification({ status: "success", title: "分组已删除" });
      onSuccess();
    } catch (err) {
      const apiErr = err as { message?: string };
      notification({
        status: "error",
        title: apiErr.message || "删除分组失败",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <FormDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <FormDialog.Content>
        <div>
          <FormDialog.Header
            icon={RiErrorWarningLine}
            iconClassName="text-error-base"
            title="确认删除分组"
            description={`即将删除分组「${groupName}」`}
          />
          <FormDialog.Body>
            <FormDialog.Error message="分组内的服务不会被删除，仅移除分组本身。" />
          </FormDialog.Body>
          <FormDialog.Footer>
            <FormDialog.Button variant="secondary" onClick={onClose}>
              取消
            </FormDialog.Button>
            <FormDialog.Button variant="danger" loading={deleting} onClick={handleDelete}>
              确认删除
            </FormDialog.Button>
          </FormDialog.Footer>
        </div>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
