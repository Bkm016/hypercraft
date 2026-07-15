"use client";

import { useState } from "react";
import { RiEditLine, RiEyeLine, RiFileCopyLine, RiRefreshLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import * as Checkbox from "@/components/ui/checkbox";
import {
  api,
  type ApiKeySummary,
  type ApiKeyScope,
  type CreateApiKeyResponse,
} from "@/lib/api";
import { notification } from "@/hooks/use-notification";
import { copyText } from "./copy-text";

const SCOPE_OPTIONS: { id: ApiKeyScope; label: string; description: string }[] = [
  { id: "read", label: "read", description: "列表 / 详情 / 状态" },
  { id: "control", label: "control", description: "启停 / 重启 / 强杀" },
  { id: "manage", label: "manage", description: "管理服务与分组" },
  { id: "logs", label: "logs", description: "查看与跟随日志" },
  { id: "attach", label: "attach", description: "WebSocket 终端" },
];

export interface EditApiKeyModalProps {
  apiKey: ApiKeySummary;
  onClose: () => void;
  onSuccess: () => void;
  onRotated: (result: CreateApiKeyResponse) => void;
}

export function EditApiKeyModal({
  apiKey,
  onClose,
  onSuccess,
  onRotated,
}: EditApiKeyModalProps) {
  const [name, setName] = useState(apiKey.name);
  const [scopes, setScopes] = useState<Set<ApiKeyScope>>(
    new Set(
      apiKey.scopes.filter((s): s is ApiKeyScope =>
        ["read", "control", "manage", "logs", "attach"].includes(s)
      )
    )
  );
  const [secret, setSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoked = !!apiKey.revoked_at;

  const toggleScope = (scope: ApiKeyScope) => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const handleReveal = async () => {
    setRevealing(true);
    setError(null);
    try {
      const resp = await api.revealApiKeySecret(apiKey.id);
      setSecret(resp.secret);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setError(apiErr.message || "获取密钥失败");
    } finally {
      setRevealing(false);
    }
  };

  const handleCopySecret = async () => {
    let value = secret;
    if (!value) {
      setRevealing(true);
      try {
        const resp = await api.revealApiKeySecret(apiKey.id);
        value = resp.secret;
        setSecret(value);
      } catch (err: unknown) {
        const apiErr = err as { message?: string };
        notification({
          status: "error",
          title: apiErr.message || "获取密钥失败",
        });
        return;
      } finally {
        setRevealing(false);
      }
    }
    const ok = await copyText(value);
    notification({
      status: ok ? "success" : "error",
      title: ok ? "已复制完整密钥" : "复制失败",
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (revoked) return;
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
      await api.updateApiKey(apiKey.id, {
        name: name.trim(),
        scopes: Array.from(scopes),
      });
      notification({ status: "success", title: "API Key 已更新" });
      onSuccess();
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setError(apiErr.message || "更新失败");
    } finally {
      setLoading(false);
    }
  };

  const handleRotate = async () => {
    if (revoked) return;
    setRotating(true);
    setError(null);
    try {
      const result = await api.rotateApiKey(apiKey.id);
      setSecret(result.secret);
      setConfirmRotate(false);
      notification({ status: "success", title: "密钥已重新生成" });
      onRotated(result);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setError(apiErr.message || "重新生成失败");
    } finally {
      setRotating(false);
    }
  };

  return (
    <>
    <FormDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <FormDialog.Content>
        <form onSubmit={handleSubmit}>
          <FormDialog.Header
            icon={RiEditLine}
            title="编辑 API Key"
            description={`修改「${apiKey.name}」的权限与名称`}
          />
          <FormDialog.Body className="space-y-6">
            {error && <FormDialog.Error message={error} />}

            {revoked && (
              <div className="rounded-lg border border-error-base/30 bg-error-lighter px-3 py-2 text-xs text-error-base">
                此 Key 已撤销，仅可查看，不可修改。
              </div>
            )}

            <FormDialog.Field label="名称" required>
              <FormDialog.Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={revoked}
              />
            </FormDialog.Field>

            <FormDialog.Field label="完整密钥">
              <div className="space-y-2">
                {secret ? (
                  <pre className="overflow-x-auto rounded-lg border border-stroke-soft-200 bg-bg-weak-50 p-3 font-mono text-xs leading-relaxed text-text-strong-950 break-all whitespace-pre-wrap select-all">
                    {secret}
                  </pre>
                ) : (
                  <code className="block truncate rounded-lg border border-stroke-soft-200 bg-bg-weak-50 px-3 py-2 font-mono text-xs text-text-sub-600">
                    {apiKey.key_prefix}…
                  </code>
                )}
                <div className="flex flex-wrap gap-2">
                  {!secret && (
                    <FormDialog.Button
                      type="button"
                      variant="secondary"
                      loading={revealing}
                      icon={RiEyeLine}
                      onClick={handleReveal}
                    >
                      显示密钥
                    </FormDialog.Button>
                  )}
                  <FormDialog.Button
                    type="button"
                    variant="secondary"
                    loading={revealing}
                    icon={RiFileCopyLine}
                    onClick={handleCopySecret}
                  >
                    复制完整密钥
                  </FormDialog.Button>
                </div>
              </div>
            </FormDialog.Field>

            <div className="border-t border-stroke-soft-200" />

            <FormDialog.Field label="Scopes" required>
              <div className="space-y-2">
                {SCOPE_OPTIONS.map((opt) => (
                  <label
                    key={opt.id}
                    className={`flex items-start gap-3 rounded-lg border border-stroke-soft-200 px-3 py-2.5 ${
                      revoked
                        ? "cursor-not-allowed opacity-60"
                        : "cursor-pointer hover:bg-bg-weak-50"
                    }`}
                  >
                    <Checkbox.Root
                      checked={scopes.has(opt.id)}
                      onCheckedChange={() => !revoked && toggleScope(opt.id)}
                      disabled={revoked}
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

            {!revoked && (
              <>
                <div className="border-t border-stroke-soft-200" />
                <div className="flex items-center justify-between gap-3 rounded-lg border border-stroke-soft-200 px-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-strong-950">
                      重新生成密钥
                    </p>
                    <p className="mt-0.5 text-xs text-text-sub-600">
                      旧明文立即失效，新密钥可随时再次查看
                    </p>
                  </div>
                  <FormDialog.Button
                    type="button"
                    variant="secondary"
                    loading={rotating}
                    icon={RiRefreshLine}
                    onClick={() => setConfirmRotate(true)}
                  >
                    重置
                  </FormDialog.Button>
                </div>
              </>
            )}
          </FormDialog.Body>

          <FormDialog.Footer>
            <FormDialog.Button type="button" variant="secondary" onClick={onClose}>
              {revoked ? "关闭" : "取消"}
            </FormDialog.Button>
            {!revoked && (
              <FormDialog.Button type="submit" loading={loading}>
                保存修改
              </FormDialog.Button>
            )}
          </FormDialog.Footer>
        </form>
      </FormDialog.Content>
    </FormDialog.Root>

    {confirmRotate && (
      <FormDialog.Root
        open
        onOpenChange={(open) => !open && !rotating && setConfirmRotate(false)}
        size="sm"
      >
        <FormDialog.Content>
          <div>
            <FormDialog.Header
              icon={RiRefreshLine}
              title="重新生成密钥"
              description={`即将重置「${apiKey.name}」`}
            />
            <FormDialog.Body>
              <FormDialog.Error message="重新生成后旧密钥立即失效，确定继续？" />
            </FormDialog.Body>
            <FormDialog.Footer>
              <FormDialog.Button
                type="button"
                variant="secondary"
                disabled={rotating}
                onClick={() => setConfirmRotate(false)}
              >
                取消
              </FormDialog.Button>
              <FormDialog.Button
                type="button"
                variant="danger"
                loading={rotating}
                onClick={handleRotate}
              >
                确认重置
              </FormDialog.Button>
            </FormDialog.Footer>
          </div>
        </FormDialog.Content>
      </FormDialog.Root>
    )}
    </>
  );
}
