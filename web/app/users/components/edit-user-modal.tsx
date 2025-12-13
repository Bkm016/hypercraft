"use client";

import { useState } from "react";
import { RiEditLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import { api, type UserSummary, type ServiceSummary, type ServiceGroup } from "@/lib/api";
import { notification } from "@/hooks/use-notification";
import { ServicePermissionPicker } from "./service-permission-picker";

export interface EditUserModalProps {
  user: UserSummary;
  services: ServiceSummary[];
  groups: ServiceGroup[];
  onClose: () => void;
  onSuccess: () => void;
}

export function EditUserModal({
  user,
  services,
  groups,
  onClose,
  onSuccess,
}: EditUserModalProps) {
  const [selectedServices, setSelectedServices] = useState<Set<string>>(
    new Set(user.service_ids.filter((id) => id !== "*"))
  );
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword && newPassword.length < 6) {
      setError("密码至少需要 6 个字符");
      return;
    }

    setLoading(true);
    try {
      await api.updateUser(user.id, {
        password: newPassword || undefined,
        service_ids: Array.from(selectedServices),
      });
      notification({ status: "success", title: "用户已更新" });
      onSuccess();
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setError(apiErr.message || "更新用户失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <FormDialog.Content>
        <form onSubmit={handleSubmit}>
          <FormDialog.Header
            icon={RiEditLine}
            title="编辑用户"
            description={`修改「${user.username}」的信息和权限`}
          />
          <FormDialog.Body className="space-y-6">
            {error && <FormDialog.Error message={error} />}

            {/* 密码修改 */}
            <div className="space-y-4">
              <FormDialog.Field label="新密码" hint="留空则不修改">
                <FormDialog.Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少 6 个字符"
                />
              </FormDialog.Field>
            </div>

            {/* 分隔线 */}
            <div className="border-t border-stroke-soft-200" />

            {/* 服务权限 */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium uppercase tracking-wider text-text-soft-400">
                服务权限
              </h4>
              <ServicePermissionPicker
                services={services}
                groups={groups}
                selectedIds={selectedServices}
                onChange={setSelectedServices}
              />
              <p className="text-xs text-text-soft-400">
                选择用户可以访问的服务
              </p>
            </div>
          </FormDialog.Body>

          <FormDialog.Footer>
            <FormDialog.Button type="button" variant="secondary" onClick={onClose}>
              取消
            </FormDialog.Button>
            <FormDialog.Button type="submit" loading={loading}>
              保存修改
            </FormDialog.Button>
          </FormDialog.Footer>
        </form>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
