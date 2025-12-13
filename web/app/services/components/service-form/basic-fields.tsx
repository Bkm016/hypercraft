"use client";

import * as FormDialog from "@/components/ui/form-dialog";
import type { ServiceFormData, FormMode } from "./types";

interface BasicFieldsProps {
  data: ServiceFormData;
  mode: FormMode;
  originalId?: string;
  setField: <K extends keyof ServiceFormData>(field: K, value: ServiceFormData[K]) => void;
}

export function BasicFields({ data, mode, originalId, setField }: BasicFieldsProps) {
  const isEditMode = mode === "edit";
  const isDuplicateMode = mode === "duplicate";

  if (isEditMode) {
    return (
      <FormDialog.Field label="服务名称" required>
        <FormDialog.Input
          placeholder="输入服务名称"
          value={data.name}
          onChange={(e) => setField("name", e.target.value)}
        />
      </FormDialog.Field>
    );
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <FormDialog.Field label="服务 ID" required hint="字母、数字、横线、下划线">
        <FormDialog.Input
          placeholder={isDuplicateMode ? `${originalId}-copy` : "my-api"}
          value={data.id}
          onChange={(e) => setField("id", e.target.value)}
        />
      </FormDialog.Field>
      <FormDialog.Field label="服务名称" required hint="友好显示名">
        <FormDialog.Input
          placeholder="我的 API 服务"
          value={data.name}
          onChange={(e) => setField("name", e.target.value)}
        />
      </FormDialog.Field>
    </div>
  );
}
