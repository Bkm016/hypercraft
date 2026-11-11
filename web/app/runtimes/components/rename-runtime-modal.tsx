"use client";

import { useState } from "react";
import { RiEditLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import { api, type Runtime } from "@/lib/api";

export interface RenameRuntimeModalProps {
  runtime: Runtime;
  onClose: () => void;
  onSuccess: () => void;
}

export function RenameRuntimeModal({ runtime, onClose, onSuccess }: RenameRuntimeModalProps) {
  const [name, setName] = useState(runtime.name);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("名称不能为空");
      return;
    }
    setLoading(true);
    try {
      await api.renameRuntime(runtime.id, name.trim());
      onSuccess();
    } catch (err: unknown) {
      setError((err as { message?: string }).message || "保存失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <FormDialog.Content>
        <form onSubmit={handleSubmit}>
          <FormDialog.Header icon={RiEditLine} title="重命名运行环境" description={runtime.id} />
          <FormDialog.Body>
            {error && <FormDialog.Error message={error} />}
            <FormDialog.Field label="显示名称" required>
              <FormDialog.Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </FormDialog.Field>
          </FormDialog.Body>
          <FormDialog.Footer>
            <FormDialog.Button type="button" variant="secondary" onClick={onClose}>
              取消
            </FormDialog.Button>
            <FormDialog.Button type="submit" loading={loading}>
              保存
            </FormDialog.Button>
          </FormDialog.Footer>
        </form>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
