"use client";

import { useState } from "react";
import { RiAddLine, RiKey2Line } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import * as Checkbox from "@/components/ui/checkbox";
import {
  api,
  type ServiceSummary,
  type ServiceGroup,
  type CreateApiKeyResponse,
  type ApiKeyScope,
} from "@/lib/api";
import { ServicePermissionPicker } from "@/app/users/components/service-permission-picker";

const SCOPE_OPTIONS: { id: ApiKeyScope; label: string; description: string }[] = [
  { id: "read", label: "read", description: "列表 / 详情 / 状态" },
  { id: "control", label: "control", description: "启停 / 重启 / 强杀" },
  { id: "logs", label: "logs", description: "查看与跟随日志" },
  { id: "attach", label: "attach", description: "WebSocket 终端" },
];

export interface CreateApiKeyModalProps {
  services: ServiceSummary[];
  groups: ServiceGroup[];
  onClose: () => void;
  onSuccess: (result: CreateApiKeyResponse) => void;
}

export function CreateApiKeyModal({
  services,
  groups,
  onClose,
  onSuccess,
}: CreateApiKeyModalProps) {
  const [name, setName] = useState("");
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [scopes, setScopes] = useState<Set<ApiKeyScope>>(
    new Set(["read", "control", "logs", "attach"])
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleScope = (scope: ApiKeyScope) => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("请输入名称");
      return;
    }
    if (scopes.size === 0) {
      setError("至少选择一个 scope");
      return;
    }

    setLoading(true);
    try {
      const result = await api.createApiKey({
        name: name.trim(),
        service_ids: Array.from(selectedServices),
        scopes: Array.from(scopes),
      });
      onSuccess(result);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setError(apiErr.message || "创建 API Key 失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <FormDialog.Content>
        <form onSubmit={handleSubmit}>
          <FormDialog.Header
            icon={RiKey2Line}
            title="创建 API Key"
            description="供 Agent / 脚本长期调用，密钥可随时在编辑页查看"
          />
          <FormDialog.Body className="space-y-6">
            {error && <FormDialog.Error message={error} />}

            <FormDialog.Field label="名称" required>
              <FormDialog.Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如 ops-bot"
              />
            </FormDialog.Field>

            <div className="border-t border-stroke-soft-200" />

            <FormDialog.Field label="Scopes" required hint="决定 Key 能调用的能力">
              <div className="space-y-2">
                {SCOPE_OPTIONS.map((opt) => (
                  <label
                    key={opt.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-stroke-soft-200 px-3 py-2.5 hover:bg-bg-weak-50"
                  >
                    <Checkbox.Root
                      checked={scopes.has(opt.id)}
                      onCheckedChange={() => toggleScope(opt.id)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block font-mono text-sm font-medium text-text-strong-950">
                        {opt.label}
                      </span>
                      <span className="block text-xs text-text-sub-600">
                        {opt.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </FormDialog.Field>

            <div className="border-t border-stroke-soft-200" />

            <FormDialog.Field
              label="服务权限"
              hint="空表示不能访问任何服务；Key 只能操作勾选的服务"
            >
              <ServicePermissionPicker
                services={services}
                groups={groups}
                selectedIds={selectedServices}
                onChange={setSelectedServices}
              />
            </FormDialog.Field>
          </FormDialog.Body>

          <FormDialog.Footer>
            <FormDialog.Button type="button" variant="secondary" onClick={onClose}>
              取消
            </FormDialog.Button>
            <FormDialog.Button type="submit" loading={loading} icon={RiAddLine}>
              创建
            </FormDialog.Button>
          </FormDialog.Footer>
        </form>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
