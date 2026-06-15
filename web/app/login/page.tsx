"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  RiEyeLine,
  RiEyeOffLine,
  RiKeyLine,
  RiLockLine,
  RiUserLine,
  RiErrorWarningLine,
  RiShieldKeyholeLine,
} from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as CompactButton from "@/components/ui/compact-button";
import { useAuth } from "@/lib/auth";
import { cn } from "@/utils/cn";

const INPUT_CLASS =
  "h-9 w-full border-0 border-b border-stroke-soft-200 bg-transparent pl-9 text-sm text-text-strong-950 placeholder:text-text-soft-400 focus:border-stroke-strong-950 focus:outline-none";

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
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="flex flex-1 flex-col justify-between border-b border-stroke-soft-200 px-6 py-10 md:border-b-0 md:border-r md:px-12 md:py-16 lg:px-16">
        <div>
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-text-sub-600">
            Hypercraft
          </p>
          <h1 className="mt-4 max-w-md text-3xl font-semibold leading-tight tracking-tight text-text-strong-950 md:text-4xl">
            服务管理平台
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-text-sub-600">
            统一管理进程、终端与配置。登录后进入控制台。
          </p>
        </div>
        <p className="mt-10 hidden font-mono text-[10px] text-text-soft-400 md:block">
          © Hypercraft
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-10 md:px-12 md:py-16">
        <div className="w-full max-w-[360px]">
          <div className="mb-8 flex gap-6 border-b border-stroke-soft-200">
            {(["user", "devtoken"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => switchMode(mode)}
                className={cn(
                  "-mb-px border-b-2 pb-3 text-sm font-medium transition-colors",
                  loginMode === mode
                    ? "border-text-strong-950 text-text-strong-950"
                    : "border-transparent text-text-sub-600 hover:text-text-strong-950",
                )}
              >
                {mode === "user" ? "用户登录" : "DevToken"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-error-base/30 bg-error-lighter px-3 py-2.5 text-sm text-error-base">
                <RiErrorWarningLine className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {loginMode === "user" ? (
              <>
                <div>
                  <label className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-text-sub-600">
                    用户名
                  </label>
                  <div className="relative">
                    <RiUserLine className="absolute left-0 top-1/2 size-4 -translate-y-1/2 text-text-soft-400" />
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

                <div>
                  <label className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-text-sub-600">
                    密码
                  </label>
                  <div className="relative">
                    <RiLockLine className="absolute left-0 top-1/2 size-4 -translate-y-1/2 text-text-soft-400" />
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
                      className="absolute right-0 top-1/2 -translate-y-1/2"
                    >
                      <CompactButton.Icon as={showPassword ? RiEyeOffLine : RiEyeLine} />
                    </CompactButton.Root>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-text-sub-600">
                  DevToken
                </label>
                <div className="relative">
                  <RiKeyLine className="absolute left-0 top-1/2 size-4 -translate-y-1/2 text-text-soft-400" />
                  <input
                    type={showDevToken ? "text" : "password"}
                    value={devToken}
                    onChange={(e) => setDevToken(e.target.value)}
                    placeholder="输入 DevToken"
                    className={cn(INPUT_CLASS, "pr-10 font-mono text-xs")}
                  />
                  <CompactButton.Root
                    type="button"
                    variant="ghost"
                    onClick={() => setShowDevToken(!showDevToken)}
                    className="absolute right-0 top-1/2 -translate-y-1/2"
                  >
                    <CompactButton.Icon as={showDevToken ? RiEyeOffLine : RiEyeLine} />
                  </CompactButton.Root>
                </div>
              </div>
            )}

            {requires2FA && (
              <div>
                <label className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-text-sub-600">
                  双因素认证码
                </label>
                <div className="relative">
                  <RiShieldKeyholeLine className="absolute left-0 top-1/2 size-4 -translate-y-1/2 text-text-soft-400" />
                  <input
                    type="text"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="6 位验证码"
                    maxLength={6}
                    autoComplete="one-time-code"
                    className={cn(INPUT_CLASS, "pr-3 font-mono tracking-widest")}
                  />
                </div>
              </div>
            )}

            <Button.Root type="submit" className="w-full" disabled={loading}>
              {loading ? "登录中…" : "登录"}
            </Button.Root>
          </form>

          <p className="mt-6 text-xs leading-relaxed text-text-sub-600">
            {loginMode === "user"
              ? "请联系管理员获取账户。"
              : "DevToken 具备完整管理员权限，请妥善保管。"}
          </p>
        </div>
      </div>
    </div>
  );
}