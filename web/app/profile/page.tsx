"use client";

import { useState, useEffect } from "react";
import {
  RiCheckLine,
  RiEyeLine,
  RiEyeOffLine,
  RiKeyLine,
  RiLogoutBoxLine,
  RiServerLine,
  RiTimeLine,
  RiUserLine,
  RiRefreshLine,
} from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as CompactButton from "@/components/ui/compact-button";
import { PageLayout, PageHeader, PageContent, PageCard } from "@/components/layout/page-layout";
import { useAuth } from "@/lib/auth";
import { api, type ServiceSummary } from "@/lib/api";

export default function ProfilePage() {
  const { user, isAdmin, logout, isAuthenticated } = useAuth();
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  
  // 密码表单
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  
  // 服务列表（用于显示服务名称）
  const [services, setServices] = useState<ServiceSummary[]>([]);

  // 判断是否是 DevToken 用户（没有密码可改）
  const isDevToken = user?.sub === "dev" || user?.token_type === "dev";

  useEffect(() => {
    if (isAuthenticated) {
      loadServices();
    }
  }, [isAuthenticated]);

  const loadServices = async () => {
    try {
      const data = await api.listServices();
      setServices(data);
    } catch {
      // 忽略错误
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的密码不一致");
      return;
    }

    if (newPassword.length < 4) {
      setPasswordError("新密码长度至少 4 位");
      return;
    }

    setSaving(true);
    try {
      await api.changePassword(user!.sub, {
        new_password: newPassword,
        current_password: currentPassword || undefined,
      });
      setPasswordSuccess("密码修改成功");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const error = err as { message?: string };
      setPasswordError(error.message || "修改密码失败");
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshToken = async () => {
    setRefreshing(true);
    try {
      const refreshToken = api.getRefreshToken();
      if (refreshToken) {
        await api.authRefresh({ refresh_token: refreshToken });
        // 刷新页面以更新状态
        window.location.reload();
      }
    } catch {
      // 刷新失败，可能需要重新登录
    } finally {
      setRefreshing(false);
    }
  };

  // 计算 token 过期时间
  const getTokenExpiry = () => {
    if (!user) return "未知";
    const expiryTime = user.exp * 1000;
    const now = Date.now();
    const diff = expiryTime - now;
    
    if (diff <= 0) return "已过期";
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours} 小时 ${minutes % 60} 分钟后`;
    }
    return `${minutes} 分钟后`;
  };

  // 获取用户有权限的服务名称
  const getUserServices = () => {
    if (!user?.service_ids) return [];
    return user.service_ids.map((id) => {
      const service = services.find((s) => s.id === id);
      return service?.name || id;
    });
  };

  // 格式化时间
  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString("zh-CN");
  };

  if (!user) {
    return (
      <PageLayout>
        <PageContent>
          <div className="flex items-center justify-center py-20">
            <p className="text-text-sub-600">加载中...</p>
          </div>
        </PageContent>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title="个人中心"
        description="管理你的账号信息和安全设置"
      />

      <PageContent maxWidth="2xl">
        <div className="space-y-6">
          {/* 账号信息 */}
          <PageCard
            title="账号信息"
            description="你的基本账号信息"
          >
            <div className="space-y-4">
              <InfoRow
                icon={<RiUserLine className="size-4" />}
                label="用户名"
                value={user.username}
              />
              <InfoRow
                icon={<RiUserLine className="size-4" />}
                label="用户 ID"
                value={<code className="text-xs bg-bg-weak-50 px-1.5 py-0.5 rounded">{user.sub}</code>}
              />
              <InfoRow
                icon={<RiUserLine className="size-4" />}
                label="角色"
                value={
                  <span
                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                      isAdmin
                        ? "bg-away-lighter text-away-base"
                        : "bg-bg-weak-50 text-text-sub-600"
                    }`}
                  >
                    {isAdmin ? "管理员" : "用户"}
                  </span>
                }
              />
              {!isAdmin && (
                <InfoRow
                  icon={<RiServerLine className="size-4" />}
                  label="服务权限"
                  value={
                    <div className="flex flex-wrap gap-1.5">
                      {getUserServices().length > 0 ? (
                        getUserServices().map((name) => (
                          <span
                            key={name}
                            className="rounded bg-bg-weak-50 px-2 py-0.5 text-xs text-text-sub-600"
                          >
                            {name}
                          </span>
                        ))
                      ) : (
                        <span className="text-text-soft-400">无服务权限</span>
                      )}
                    </div>
                  }
                />
              )}
              <InfoRow
                icon={<RiTimeLine className="size-4" />}
                label="Token 签发时间"
                value={formatDate(user.iat)}
              />
            </div>
          </PageCard>

          {/* Token 状态 */}
          <PageCard
            title="Token 状态"
            description="访问令牌的有效期信息"
          >
            <div className="flex items-center justify-between rounded-lg bg-bg-weak-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary-alpha-10 p-2">
                  <RiKeyLine className="size-4 text-primary-base" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-strong-950">访问令牌</p>
                  <p className="text-xs text-text-sub-600">
                    将在 <span className="font-medium text-away-base">{getTokenExpiry()}</span> 过期
                  </p>
                </div>
              </div>
              <Button.Root 
                size="xsmall" 
                variant="neutral" 
                mode="stroke"
                onClick={handleRefreshToken}
                disabled={refreshing}
              >
                {refreshing ? (
                  <>
                    <RiRefreshLine className="size-3.5 animate-spin" />
                    刷新中...
                  </>
                ) : (
                  <>
                    <RiRefreshLine className="size-3.5" />
                    刷新
                  </>
                )}
              </Button.Root>
            </div>
          </PageCard>

          {/* 修改密码 - DevToken 用户无法修改密码 */}
          {isDevToken ? (
            <PageCard
              title="修改密码"
              description="更新你的登录密码"
            >
              <div className="rounded-lg bg-bg-weak-50 px-4 py-6 text-center">
                <RiKeyLine className="mx-auto size-8 text-text-soft-400" />
                <p className="mt-2 text-sm text-text-sub-600">
                  DevToken 用户无需密码，不支持修改密码
                </p>
              </div>
            </PageCard>
          ) : (
          <PageCard
            title="修改密码"
            description="更新你的登录密码"
          >
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              {passwordError && (
                <div className="rounded-lg bg-error-lighter px-4 py-3 text-sm text-error-base">
                  {passwordError}
                </div>
              )}
              {passwordSuccess && (
                <div className="rounded-lg bg-success-lighter px-4 py-3 text-sm text-success-base">
                  {passwordSuccess}
                </div>
              )}

              {!isAdmin && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-strong-950">
                    当前密码
                  </label>
                  <div className="relative">
                    <input
                      type={showCurrentPassword ? "text" : "password"}
                      placeholder="输入当前密码"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="h-10 w-full rounded-lg border border-stroke-soft-200 bg-bg-white-0 px-3 pr-10 text-sm text-text-strong-950 placeholder:text-text-soft-400 focus:border-primary-base focus:outline-none focus:ring-2 focus:ring-primary-alpha-10"
                    />
                    <CompactButton.Root
                      type="button"
                      variant="ghost"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-1 top-1/2 -translate-y-1/2"
                    >
                      <CompactButton.Icon as={showCurrentPassword ? RiEyeOffLine : RiEyeLine} />
                    </CompactButton.Root>
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-strong-950">
                  新密码
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    placeholder="输入新密码"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="h-10 w-full rounded-lg border border-stroke-soft-200 bg-bg-white-0 px-3 pr-10 text-sm text-text-strong-950 placeholder:text-text-soft-400 focus:border-primary-base focus:outline-none focus:ring-2 focus:ring-primary-alpha-10"
                  />
                  <CompactButton.Root
                    type="button"
                    variant="ghost"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-1 top-1/2 -translate-y-1/2"
                  >
                    <CompactButton.Icon as={showNewPassword ? RiEyeOffLine : RiEyeLine} />
                  </CompactButton.Root>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-strong-950">
                  确认新密码
                </label>
                <input
                  type="password"
                  placeholder="再次输入新密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-10 w-full rounded-lg border border-stroke-soft-200 bg-bg-white-0 px-3 text-sm text-text-strong-950 placeholder:text-text-soft-400 focus:border-primary-base focus:outline-none focus:ring-2 focus:ring-primary-alpha-10"
                />
              </div>

              <Button.Root type="submit" size="small" disabled={saving || !newPassword}>
                {saving ? (
                  "保存中..."
                ) : (
                  <>
                    <Button.Icon as={RiCheckLine} />
                    保存密码
                  </>
                )}
              </Button.Root>
            </form>
          </PageCard>
          )}

          {/* 退出登录 */}
          <div className="rounded-xl border border-error-light bg-error-lighter p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-error-base">退出登录</h3>
                <p className="mt-0.5 text-sm text-error-base/80">
                  退出当前账号，清除本地登录状态
                </p>
              </div>
              <Button.Root size="small" variant="error" mode="stroke" onClick={logout}>
                <Button.Icon as={RiLogoutBoxLine} />
                退出
              </Button.Root>
            </div>
          </div>
        </div>
      </PageContent>
    </PageLayout>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-stroke-soft-200 pb-4 last:border-0 last:pb-0">
      <div className="flex items-center gap-2 text-text-sub-600">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <div className="text-sm text-text-strong-950">{value}</div>
    </div>
  );
}
