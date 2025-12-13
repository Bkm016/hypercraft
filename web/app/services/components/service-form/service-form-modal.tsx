"use client";

import { useState, useEffect, useRef } from "react";
import { RiServerLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import { api, type ServiceManifest } from "@/lib/api";
import { notification } from "@/hooks/use-notification";
import { useServiceForm } from "./use-service-form";
import { BasicFields } from "./basic-fields";
import { CommandFields } from "./command-fields";
import { OptionsFields } from "./options-fields";
import { EnvVarsFields } from "./env-vars-fields";
import { ScheduleFields } from "./schedule-fields";
import type { FormMode } from "./types";

export interface ServiceFormModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** 编辑模式时传入现有服务配置 */
  manifest?: ServiceManifest;
  /** 复制模式时传入要复制的服务配置 */
  duplicateFrom?: ServiceManifest;
}

export function ServiceFormModal({
  open,
  onClose,
  onSuccess,
  manifest,
  duplicateFrom,
}: ServiceFormModalProps) {
  // 用 ref 锁定打开时的模式，防止关闭动画期间闪烁
  const modeRef = useRef<FormMode>("create");
  const manifestRef = useRef<ServiceManifest | undefined>(undefined);

  // 只在打开时更新模式
  if (open && !manifestRef.current) {
    if (manifest) {
      modeRef.current = "edit";
      manifestRef.current = manifest;
    } else if (duplicateFrom) {
      modeRef.current = "duplicate";
      manifestRef.current = duplicateFrom;
    } else {
      modeRef.current = "create";
    }
  }

  // 弹窗关闭后重置 ref
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        modeRef.current = "create";
        manifestRef.current = undefined;
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const mode = modeRef.current;
  const currentManifest = manifestRef.current || manifest || duplicateFrom;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useServiceForm({ mode, manifest: currentManifest });

  // 初始化表单
  useEffect(() => {
    if (open) {
      form.initForm(currentManifest);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = await form.validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const serviceData = form.buildManifest(currentManifest);

    setSaving(true);
    try {
      if (form.isEditMode) {
        await api.updateService(currentManifest!.id, serviceData);
        notification({ status: "success", title: "服务已更新" });
      } else {
        await api.createService(serviceData);
        notification({
          status: "success",
          title: form.isDuplicateMode ? "服务已复制" : "服务已创建",
        });
      }
      onSuccess();
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setError(
        apiErr.message ||
          (form.isEditMode
            ? "更新服务失败"
            : form.isDuplicateMode
              ? "复制服务失败"
              : "创建服务失败")
      );
    } finally {
      setSaving(false);
    }
  };

  const title = form.isEditMode
    ? "编辑服务"
    : form.isDuplicateMode
      ? "复制服务"
      : "新建服务";

  const description = form.isEditMode
    ? `修改「${currentManifest?.id}」的配置`
    : form.isDuplicateMode
      ? `基于「${currentManifest?.id}」创建副本`
      : "创建一个新的服务实例";

  const submitText = form.isEditMode
    ? "保存修改"
    : form.isDuplicateMode
      ? "复制服务"
      : "新建服务";

  return (
    <FormDialog.Root open={open} onOpenChange={(o) => !o && onClose()} size="lg">
      <FormDialog.Content>
        <form onSubmit={handleSubmit}>
          <FormDialog.Header icon={RiServerLine} title={title} description={description} />

          <FormDialog.Body className="space-y-6">
            {error && <FormDialog.Error message={error} />}

            <div className="space-y-5">
              <BasicFields
                data={form.data}
                mode={mode}
                originalId={currentManifest?.id}
                setField={form.setField}
              />

              <div className="border-t border-stroke-soft-200" />

              <CommandFields data={form.data} setField={form.setField} />

              <div className="border-t border-stroke-soft-200" />

              <OptionsFields data={form.data} setField={form.setField} />
            </div>

            <EnvVarsFields
              envVars={form.data.envVars}
              onAdd={form.addEnvVar}
              onRemove={form.removeEnvVar}
              onUpdate={form.updateEnvVar}
            />

            <ScheduleFields
              data={form.data}
              setField={form.setField}
              cronError={form.cronError}
              cronValidating={form.cronValidating}
            />
          </FormDialog.Body>

          <FormDialog.Footer>
            <FormDialog.Button type="button" variant="secondary" onClick={onClose}>
              取消
            </FormDialog.Button>
            <FormDialog.Button type="submit" loading={saving}>
              {submitText}
            </FormDialog.Button>
          </FormDialog.Footer>
        </form>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
