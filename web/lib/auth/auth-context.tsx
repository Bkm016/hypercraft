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
import { api, type TokenClaims } from "@/lib/api";

// 后端连接状态
type ConnectionStatus = "checking" | "connected" | "disconnected";

interface AuthContextValue {
  // 状态
  user: TokenClaims | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  connectionStatus: ConnectionStatus;

  // 操作
  login: (username: string, password: string) => Promise<void>;
  loginWithDevToken: (token: string) => Promise<void>;
  logout: () => void;
  retryConnection: () => Promise<void>;

  // 工具
  canAccessService: (serviceId: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// 解析 JWT payload（不验证签名，验证由后端完成）
function parseJwt(token: string): TokenClaims | null {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

// 检查 token 是否过期
function isTokenExpired(claims: TokenClaims): boolean {
  return claims.exp * 1000 < Date.now();
}

// DevToken 的虚拟 claims（不是JWT，所以需要手动构造）
function createDevTokenClaims(): TokenClaims {
  return {
    sub: "dev",
    username: "DevToken",
    token_type: "dev",
    service_ids: [],
    exp: Math.floor(Date.now() / 1000) + 86400 * 365, // 1年后过期
    iat: Math.floor(Date.now() / 1000),
  };
}

// 公开路由（不需要认证）
const publicRoutes = ["/login"];

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
      });
      return response.ok;
    } catch {
      return false;
    }
  }, []);

  const retryConnection = useCallback(async () => {
    setConnectionStatus("checking");
    const connected = await checkConnection();
    setConnectionStatus(connected ? "connected" : "disconnected");
  }, [checkConnection]);

  // 初始化：先检查后端连接，再恢复登录状态
  useEffect(() => {
    const init = async () => {
      // 先检查后端连接
      const connected = await checkConnection();
      setConnectionStatus(connected ? "connected" : "disconnected");

      if (!connected) {
        setIsLoading(false);
        return;
      }

      // 恢复登录状态
      const accessToken = api.getAccessToken();
      if (accessToken) {
        // 检查是否是 devtoken（不是 JWT 格式）
        const isDevToken = !accessToken.includes(".");
        if (isDevToken) {
          // DevToken：验证有效性
          try {
            await api.listServices();
            setUser(createDevTokenClaims());
          } catch {
            api.clearTokens();
          }
        } else {
          // JWT：解析 claims
          const claims = parseJwt(accessToken);
          if (claims && !isTokenExpired(claims)) {
            setUser(claims);
          } else {
            // token 过期，清除
            api.clearTokens();
          }
        }
      }
      setIsLoading(false);
    };

    init();
  }, [checkConnection]);

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

  const login = useCallback(async (username: string, password: string) => {
    const tokens = await api.login({ username, password });
    const claims = parseJwt(tokens.access_token);
    if (claims) {
      setUser(claims);
    }
  }, []);

  // DevToken 登录：直接使用 token 验证
  const loginWithDevToken = useCallback(async (token: string) => {
    // 先设置 token
    api.setDevToken(token);
    
    // 尝试调用一个需要认证的 API 来验证 token 是否有效
    try {
      await api.listServices();
      // 验证成功，设置用户状态
      setUser(createDevTokenClaims());
    } catch {
      // 验证失败，清除 token
      api.clearTokens();
      throw new Error("DevToken 无效");
    }
  }, []);

  const logout = useCallback(() => {
    api.logout();
    setUser(null);
    router.push("/login");
  }, [router]);

  const canAccessService = useCallback(
    (serviceId: string): boolean => {
      if (!user) return false;
      if (user.token_type === "dev") return true;
      return user.service_ids?.includes(serviceId) ?? false;
    },
    [user]
  );

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: !!user,
    isAdmin: user?.token_type === "dev",
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
          <div className="w-full max-w-sm rounded-xl border border-stroke-soft-200 bg-bg-white-0 p-6 text-center shadow-sm">
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
