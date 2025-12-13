"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { RiEyeLine, RiEyeOffLine, RiKeyLine, RiLockLine, RiUserLine, RiErrorWarningLine } from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as CompactButton from "@/components/ui/compact-button";
import { PageLayout, PageCard } from "@/components/layout/page-layout";
import { useAuth } from "@/lib/auth";
import { cn } from "@/utils/cn";

export default function LoginPage() {
  const [loginMode, setLoginMode] = useState<"user" | "devtoken">("user");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [devToken, setDevToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showDevToken, setShowDevToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { login, loginWithDevToken, isAuthenticated } = useAuth();
  const router = useRouter();

  // 如果已登录，重定向到首页
  useEffect(() => {
    if (isAuthenticated) {
      router.push("/");
    }
  }, [isAuthenticated, router]);

  // 已登录时不渲染登录页面
  if (isAuthenticated) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (loginMode === "user") {
      if (!username.trim()) {
        setError("请输入用户名");
        return;
      }
      if (!password) {
        setError("请输入密码");
        return;
      }

      setLoading(true);
      try {
        await login(username, password);
        router.push("/");
      } catch (err: unknown) {
        const apiError = err as { message?: string };
        setError(apiError.message || "登录失败，请检查用户名和密码");
      } finally {
        setLoading(false);
      }
    } else {
      if (!devToken.trim()) {
        setError("请输入 DevToken");
        return;
      }

      setLoading(true);
      try {
        await loginWithDevToken(devToken.trim());
        router.push("/");
      } catch (err: unknown) {
        const apiError = err as { message?: string };
        setError(apiError.message || "DevToken 验证失败");
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
          {/* 登录模式切换 - 带滑动动画的 Tab */}
          <div className="relative mb-6 flex rounded-lg bg-bg-weak-50 p-1">
            {/* 滑动指示器 */}
            <div
              className={cn(
                "absolute top-1 bottom-1 w-[calc(50%-2px)] rounded-md bg-bg-white-0 shadow-sm",
                "transition-transform duration-200 ease-out",
                loginMode === "user" ? "translate-x-0" : "translate-x-[calc(100%-4px)]"
              )}
            />
            <button
              type="button"
              onClick={() => { setLoginMode("user"); setError(null); }}
              className={cn(
                "relative z-10 flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200",
                loginMode === "user"
                  ? "text-text-strong-950"
                  : "text-text-sub-600 hover:text-text-strong-950"
              )}
            >
              用户登录
            </button>
            <button
              type="button"
              onClick={() => { setLoginMode("devtoken"); setError(null); }}
              className={cn(
                "relative z-10 flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200",
                loginMode === "devtoken"
                  ? "text-text-strong-950"
                  : "text-text-sub-600 hover:text-text-strong-950"
              )}
            >
              DevToken
            </button>
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
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-strong-950">
                    用户名
                  </label>
                  <div className="relative">
                    <RiUserLine className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-soft-400" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="输入用户名"
                      autoComplete="username"
                      className="h-10 w-full rounded-lg border border-stroke-soft-200 bg-bg-white-0 pl-10 pr-3 text-sm text-text-strong-950 placeholder:text-text-soft-400 focus:border-primary-base focus:outline-none focus:ring-2 focus:ring-primary-alpha-10"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-strong-950">
                    密码
                  </label>
                  <div className="relative">
                    <RiLockLine className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-soft-400" />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="输入密码"
                      autoComplete="current-password"
                      className="h-10 w-full rounded-lg border border-stroke-soft-200 bg-bg-white-0 pl-10 pr-10 text-sm text-text-strong-950 placeholder:text-text-soft-400 focus:border-primary-base focus:outline-none focus:ring-2 focus:ring-primary-alpha-10"
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
                <label className="mb-1.5 block text-sm font-medium text-text-strong-950">
                  DevToken
                </label>
                <div className="relative">
                  <RiKeyLine className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-soft-400" />
                  <input
                    type={showDevToken ? "text" : "password"}
                    value={devToken}
                    onChange={(e) => setDevToken(e.target.value)}
                    placeholder="输入 DevToken"
                    className="h-10 w-full rounded-lg border border-stroke-soft-200 bg-bg-white-0 pl-10 pr-10 font-mono text-sm text-text-strong-950 placeholder:text-text-soft-400 focus:border-primary-base focus:outline-none focus:ring-2 focus:ring-primary-alpha-10"
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
                <p className="mt-1.5 text-xs text-text-sub-600">
                  DevToken 可在启动 API 服务时通过 --dev-token 参数设置
                </p>
              </div>
            )}

            <Button.Root
              type="submit"
              className="w-full"
              disabled={loading}
            >
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
