"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import * as Button from "@/components/ui/button";
import {
  api,
  SESSION_EXPIRES_AT_KEY,
  SESSION_INVALID_EVENT,
  type TokenClaims,
  type UserSummary,
} from "@/lib/api";

// 后端连接状态
type ConnectionStatus = "checking" | "connected" | "disconnected";

interface AuthContextValue {
  // 状态
  user: TokenClaims | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  connectionStatus: ConnectionStatus;

  // 操作
  login: (username: string, password: string, totpCode?: string) => Promise<void>;
  loginWithDevToken: (token: string, totpCode?: string) => Promise<void>;
  logout: () => void;
  retryConnection: () => Promise<void>;

  // 工具
  canAccessService: (serviceId: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** 将 /auth/me 用户摘要映射为前端会话 claims（token 本身在 HttpOnly cookie 中） */
function userSummaryToClaims(user: UserSummary, expiresIn?: number): TokenClaims {
  const now = Math.floor(Date.now() / 1000);
  const exp =
    api.getSessionExpiresAt() ??
    (expiresIn != null ? now + expiresIn : now + 6 * 60 * 60);
  return {
    sub: user.id,
    username: user.username,
    token_type: "user",
    service_ids: user.service_ids,
    is_admin: user.is_admin,
    exp,
    iat: now,
  };
}

// 公开路由（不需要认证）
const publicRoutes = ["/login"];

// 提前续期，给休眠唤醒、网络波动和并发请求留出余量。
const REFRESH_ADVANCE_MS = 5 * 60 * 1000;

// 网络异常时保留现有会话并短暂重试，避免瞬时故障把用户踢出。
const REFRESH_RETRY_MS = 60 * 1000;

// 短 TTL 环境也要限制刷新频率，避免立即循环触发限流。
const MIN_REFRESH_INTERVAL_MS = 30 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TokenClaims | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("checking");
  const router = useRouter();
  const pathname = usePathname();

  // 检查后端连接
  const checkConnection = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`${api.getBaseUrl()}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
        credentials: "include",
      });
      return response.ok;
    } catch {
      return false;
    }
  }, []);

  const retryConnection = useCallback(async () => {
    setConnectionStatus("checking");
    const connected = await checkConnection();
    if (!connected) {
      setConnectionStatus("disconnected");
      return;
    }

    try {
      const me = await api.getMe();
      api.markSessionHint(true);
      setUser(userSummaryToClaims(me));
    } catch (error) {
      if ((error as { status?: number }).status === 401) {
        api.clearSession();
        setUser(null);
      } else {
        setConnectionStatus("disconnected");
        return;
      }
    }
    setConnectionStatus("connected");
  }, [checkConnection]);

  // 初始化：先检查后端连接，再通过 cookie 会话恢复登录状态
  useEffect(() => {
    const init = async () => {
      // 先检查后端连接
      const connected = await checkConnection();
      setConnectionStatus(connected ? "connected" : "disconnected");

      if (!connected) {
        setIsLoading(false);
        return;
      }

      // 清理旧版 localStorage 中的明文 token，会话改由 HttpOnly cookie 承载
      if (typeof window !== "undefined") {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
      }

      try {
        // request() 在 access 失效时会自动用 refresh cookie 续期
        const me = await api.getMe();
        api.markSessionHint(true);
        if (!api.getSessionExpiresAt()) {
          // 从旧版本升级时没有会话元数据，主动续期一次以建立准确调度时间。
          await api.refreshSession(true);
        }
        setUser(userSummaryToClaims(me));
      } catch (error) {
        if ((error as { status?: number }).status === 401) {
          api.clearSession();
          setUser(null);
        } else {
          setConnectionStatus("disconnected");
        }
      }
      setIsLoading(false);
    };

    init();
  }, [checkConnection]);

  useEffect(() => {
    const handleSessionInvalid = () => setUser(null);
    window.addEventListener(SESSION_INVALID_EVENT, handleSessionInvalid);
    return () => window.removeEventListener(SESSION_INVALID_EVENT, handleSessionInvalid);
  }, []);

  // Access Token 到期前主动续期；页面休眠后恢复时立即补做过期检查。
  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const refreshSession = async () => {
      try {
        await api.refreshSession();
        if (cancelled) return;

        const now = Math.floor(Date.now() / 1000);
        setUser((current) => current ? {
          ...current,
          exp: api.getSessionExpiresAt() ?? current.exp,
          iat: now,
        } : null);
      } catch (error) {
        if (cancelled) return;
        if ((error as { status?: number }).status === 401) {
          api.invalidateSession();
          return;
        }
        refreshTimer = setTimeout(() => void refreshSession(), REFRESH_RETRY_MS);
      }
    };

    const scheduleRefresh = () => {
      const expiresAt = api.getSessionExpiresAt() ?? user.exp;
      const sessionTtlMs = Math.max(0, (expiresAt - user.iat) * 1000);
      const refreshAdvanceMs = Math.min(REFRESH_ADVANCE_MS, sessionTtlMs / 5);
      const delay = Math.max(
        MIN_REFRESH_INTERVAL_MS,
        expiresAt * 1000 - Date.now() - refreshAdvanceMs
      );
      refreshTimer = setTimeout(() => void refreshSession(), delay);
    };

    const refreshIfDue = () => {
      const expiresAt = api.getSessionExpiresAt() ?? user.exp;
      if (expiresAt * 1000 - Date.now() <= REFRESH_ADVANCE_MS) {
        if (refreshTimer) clearTimeout(refreshTimer);
        void refreshSession();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshIfDue();
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== SESSION_EXPIRES_AT_KEY) return;
      if (event.newValue === null) {
        setUser(null);
        return;
      }
      const expiresAt = Number(event.newValue);
      if (!Number.isFinite(expiresAt) || expiresAt <= 0) return;
      setUser((current) => current ? { ...current, exp: expiresAt } : null);
    };

    scheduleRefresh();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", refreshIfDue);
    window.addEventListener("online", refreshIfDue);
    window.addEventListener("storage", handleStorage);
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", refreshIfDue);
      window.removeEventListener("online", refreshIfDue);
      window.removeEventListener("storage", handleStorage);
    };
  }, [user]);

  // 路由保护
  useEffect(() => {
    if (isLoading) return;

    const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route));

    if (!user && !isPublicRoute) {
      router.push("/login");
    } else if (user && pathname === "/login") {
      router.push("/");
    }
  }, [user, isLoading, pathname, router]);

  const login = useCallback(async (username: string, password: string, totpCode?: string) => {
    const tokens = await api.login({ username, password, totp_code: totpCode });
    const me = await api.getMe();
    setUser(userSummaryToClaims(me, tokens.expires_in));
  }, []);

  // DevToken 登录：调用 /auth/devtoken 接口，验证 2FA 后签发 JWT
  const loginWithDevToken = useCallback(async (token: string, totpCode?: string) => {
    const tokens = await api.devtokenLogin({ dev_token: token, totp_code: totpCode });
    const me = await api.getMe();
    setUser(userSummaryToClaims(me, tokens.expires_in));
  }, []);

  const logout = useCallback(() => {
    void api.logout();
    setUser(null);
    router.push("/login");
  }, [router]);

  const canAccessService = useCallback(
    (serviceId: string): boolean => {
      if (!user) return false;
      if (user.sub === "__devtoken__") return true;
      return user.service_ids?.includes(serviceId) ?? false;
    },
    [user]
  );

  const isSuperAdmin = user?.sub === "__devtoken__";
  const isAdmin = isSuperAdmin || !!user?.is_admin;

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: !!user,
    isSuperAdmin,
    isAdmin,
    connectionStatus,
    login,
    loginWithDevToken,
    logout,
    retryConnection,
    canAccessService,
  };

  // 后端连接检查中 - 显示加载
  if (connectionStatus === "checking") {
    return (
      <AuthContext.Provider value={value}>
        <div className="flex min-h-screen items-center justify-center bg-bg-white-0">
          <div className="text-center">
            <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-primary-base border-t-transparent" />
            <p className="text-sm text-text-sub-600">正在连接服务器...</p>
          </div>
        </div>
      </AuthContext.Provider>
    );
  }

  // 后端未连接 - 显示错误页面
  if (connectionStatus === "disconnected") {
    return (
      <AuthContext.Provider value={value}>
        <div className="flex min-h-screen items-center justify-center bg-bg-white-0 p-4">
          <div className="w-full max-w-sm rounded-lg border border-stroke-soft-200 bg-bg-white-0 p-6 text-center">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-error-lighter">
              <svg className="size-6 text-error-base" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="mb-2 text-lg font-semibold text-text-strong-950">无法连接到服务器</h2>
            <p className="mb-6 text-sm text-text-sub-600">
              请确保后端服务已启动并且网络连接正常
            </p>
            <Button.Root onClick={retryConnection} className="w-full">
              重试连接
            </Button.Root>
          </div>
        </div>
      </AuthContext.Provider>
    );
  }

  // 正在加载认证状态
  if (isLoading) {
    return (
      <AuthContext.Provider value={value}>
        <div className="flex min-h-screen items-center justify-center bg-bg-white-0">
          <div className="text-center">
            <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-primary-base border-t-transparent" />
            <p className="text-sm text-text-sub-600">正在加载...</p>
          </div>
        </div>
      </AuthContext.Provider>
    );
  }

  // 检查是否需要认证
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route));
  
  // 未登录且不是公开路由 - 显示空白（等待路由跳转）
  if (!user && !isPublicRoute) {
    return (
      <AuthContext.Provider value={value}>
        <div className="flex min-h-screen items-center justify-center bg-bg-white-0">
          <div className="text-center">
            <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-primary-base border-t-transparent" />
            <p className="text-sm text-text-sub-600">正在跳转...</p>
          </div>
        </div>
      </AuthContext.Provider>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
