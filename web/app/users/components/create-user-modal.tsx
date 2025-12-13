"use client";

import { useState } from "react";
import { RiAddLine, RiUserLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import { api, type ServiceSummary, type ServiceGroup } from "@/lib/api";
import { notification } from "@/hooks/use-notification";
import { ServicePermissionPicker } from "./service-permission-picker";

export interface CreateUserModalProps {
  services: ServiceSummary[];
  groups: ServiceGroup[];
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateUserModal({
  services,
  groups,
  onClose,
  onSuccess,
}: CreateUserModalProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim()) {
      setError("请输入用户名");
      return;
    }
    if (password.length < 6) {
      setError("密码至少需要 6 个字符");
      return;
    }

    setLoading(true);
    try {
      await api.createUser({
        username: username.trim(),
        password,
        service_ids: Array.from(selectedServices),
      });
      notification({ status: "success", title: "用户已创建" });
      onSuccess();
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setError(apiErr.message || "创建用户失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <FormDialog.Content>
        <form onSubmit={handleSubmit}>
          <FormDialog.Header
            icon={RiUserLine}
            title="添加用户"
            description="创建新的系统用户"
          />
          <FormDialog.Body className="space-y-6">
            {error && <FormDialog.Error message={error} />}

            {/* 账户信息 */}
            <div className="space-y-4">
              <FormDialog.Field label="用户名" required>
                <FormDialog.Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="输入用户名"
                />
              </FormDialog.Field>

              <FormDialog.Field label="密码" required hint="至少 6 个字符">
                <FormDialog.Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="设置密码"
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
            <FormDialog.Button type="submit" loading={loading} icon={RiAddLine}>
              创建用户
            </FormDialog.Button>
          </FormDialog.Footer>
        </form>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
