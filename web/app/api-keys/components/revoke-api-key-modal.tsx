"use client";

import { useState } from "react";
import { RiErrorWarningLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import type { ApiKeySummary } from "@/lib/api";

export interface RevokeApiKeyModalProps {
  apiKey: ApiKeySummary;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function RevokeApiKeyModal({
  apiKey,
  onClose,
  onConfirm,
}: RevokeApiKeyModalProps) {
  const [loading, setLoading] = useState(false);

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
            title="确认撤销 API Key"
            description={`即将撤销「${apiKey.name}」`}
          />
          <FormDialog.Body>
            <FormDialog.Error message="撤销后立即失效且不可恢复。需要时请重新创建。" />
          </FormDialog.Body>
          <FormDialog.Footer>
            <FormDialog.Button variant="secondary" onClick={onClose}>
              取消
            </FormDialog.Button>
            <FormDialog.Button
              variant="danger"
              loading={loading}
              onClick={handleConfirm}
            >
              确认撤销
            </FormDialog.Button>
          </FormDialog.Footer>
        </div>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
