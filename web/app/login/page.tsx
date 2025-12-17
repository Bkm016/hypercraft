"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { RiEyeLine, RiEyeOffLine, RiKeyLine, RiLockLine, RiUserLine, RiErrorWarningLine, RiShieldKeyholeLine } from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as CompactButton from "@/components/ui/compact-button";
import { PageLayout, PageCard } from "@/components/layout/page-layout";
import { useAuth } from "@/lib/auth";
import { cn } from "@/utils/cn";

// 通用输入框样式
const INPUT_CLASS = "h-10 w-full rounded-lg border border-stroke-soft-200 bg-bg-white-0 pl-10 text-sm text-text-strong-950 placeholder:text-text-soft-400 focus:border-primary-base focus:outline-none focus:ring-2 focus:ring-primary-alpha-10";

export default function LoginPage() {
  const [loginMode, setLoginMode] = useState<"user" | "devtoken">("user");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [devToken, setDevToken] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [requires2FA, setRequires2FA] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showDevToken, setShowDevToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { login, loginWithDevToken, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated) router.push("/");
  }, [isAuthenticated, router]);

  if (isAuthenticated) return null;

  const switchMode = (mode: "user" | "devtoken") => {
    setLoginMode(mode);
    setError(null);
    setRequires2FA(false);
    setTotpCode("");
  };

  const handle2FAError = (apiError: { code?: string; message?: string }) => {
    const message = apiError.message || "";
    if (
      apiError.code === "2FA_REQUIRED" ||
      (message.includes("2FA") && (message.includes("required") || message.includes("需要")))
    ) {
      setRequires2FA(true);
      setError("请输入双因素认证码");
    } else if (message.includes("验证码")) {
      setRequires2FA(true);
      setError("验证码错误，请重新输入");
    } else {
      setError(message || "登录失败");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (loginMode === "user") {
      if (!username.trim()) return setError("请输入用户名");
      if (!password) return setError("请输入密码");
      if (requires2FA && !totpCode.trim()) return setError("请输入双因素认证码");

      setLoading(true);
      try {
        await login(username, password, totpCode || undefined);
        router.push("/");
      } catch (err) {
        handle2FAError(err as { code?: string; message?: string });
      } finally {
        setLoading(false);
      }
    } else {
      if (!devToken.trim()) return setError("请输入 DevToken");
      if (requires2FA && !totpCode.trim()) return setError("请输入双因素认证码");

      setLoading(true);
      try {
        await loginWithDevToken(devToken.trim(), totpCode.trim() || undefined);
        router.push("/");
      } catch (err) {
        handle2FAError(err as { code?: string; message?: string });
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <PageLayout variant="centered">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-text-strong-950">Hypercraft</h1>
          <p className="mt-2 text-sm text-text-sub-600">登录到服务管理平台</p>
        </div>

        <PageCard>
          {/* 登录模式切换 */}
          <div className="relative mb-6 flex rounded-lg bg-bg-weak-50 p-1">
            <div
              className={cn(
                "absolute top-1 bottom-1 w-[calc(50%-2px)] rounded-md bg-bg-white-0 shadow-sm transition-transform duration-200 ease-out",
                loginMode === "user" ? "translate-x-0" : "translate-x-[calc(100%-4px)]"
              )}
            />
            {(["user", "devtoken"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => switchMode(mode)}
                className={cn(
                  "relative z-10 flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200",
                  loginMode === mode ? "text-text-strong-950" : "text-text-sub-600 hover:text-text-strong-950"
                )}
              >
                {mode === "user" ? "用户登录" : "DevToken"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-error-lighter p-3 text-sm text-error-base">
                <RiErrorWarningLine className="size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {loginMode === "user" ? (
              <>
                {/* 用户名 */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-strong-950">用户名</label>
                  <div className="relative">
                    <RiUserLine className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-soft-400" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="输入用户名"
                      autoComplete="username"
                      className={cn(INPUT_CLASS, "pr-3")}
                    />
                  </div>
                </div>

                {/* 密码 */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-strong-950">密码</label>
                  <div className="relative">
                    <RiLockLine className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-soft-400" />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="输入密码"
                      autoComplete="current-password"
                      className={cn(INPUT_CLASS, "pr-10")}
                    />
                    <CompactButton.Root
                      type="button"
                      variant="ghost"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-1 top-1/2 -translate-y-1/2"
                    >
                      <CompactButton.Icon as={showPassword ? RiEyeOffLine : RiEyeLine} />
                    </CompactButton.Root>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-strong-950">DevToken</label>
                <div className="relative">
                  <RiKeyLine className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-soft-400" />
                  <input
                    type={showDevToken ? "text" : "password"}
                    value={devToken}
                    onChange={(e) => setDevToken(e.target.value)}
                    placeholder="输入 DevToken"
                    className={cn(INPUT_CLASS, "pr-10 font-mono")}
                  />
                  <CompactButton.Root
                    type="button"
                    variant="ghost"
                    onClick={() => setShowDevToken(!showDevToken)}
                    className="absolute right-1 top-1/2 -translate-y-1/2"
                  >
                    <CompactButton.Icon as={showDevToken ? RiEyeOffLine : RiEyeLine} />
                  </CompactButton.Root>
                </div>
              </div>
            )}

            {/* 2FA 验证码 */}
            {requires2FA && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-strong-950">双因素认证码</label>
                <div className="relative">
                  <RiShieldKeyholeLine className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-soft-400" />
                  <input
                    type="text"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="输入 6 位验证码"
                    maxLength={6}
                    autoComplete="one-time-code"
                    className={cn(INPUT_CLASS, "pr-3")}
                  />
                </div>
              </div>
            )}

            <Button.Root type="submit" className="w-full" disabled={loading}>
              {loading ? "登录中..." : "登录"}
            </Button.Root>
          </form>

          <div className="mt-4 rounded-lg bg-bg-weak-50 p-3">
            <p className="text-xs text-text-sub-600">
              <span className="font-medium text-text-strong-950">提示：</span>
              {loginMode === "user"
                ? "请联系管理员获取账户信息"
                : "DevToken 具有完整管理员权限，请妥善保管"}
            </p>
          </div>
        </PageCard>
      </div>
    </PageLayout>
  );
}
