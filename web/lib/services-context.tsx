"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { api, type ServiceSummary, type ServiceDetail, type ServiceGroup } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface ServicesContextValue {
  // 服务列表状态
  services: ServiceSummary[];
  groups: ServiceGroup[];
  loading: boolean;
  error: string | null;
  
  // 操作
  refreshServices: () => Promise<void>;
  refreshGroups: () => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshService: (id: string) => Promise<ServiceDetail | null>;
  
  // 获取单个服务状态
  getServiceState: (id: string) => "running" | "stopped" | "unknown";
  
  // 设置轮询间隔 (0 = 禁用)
  setPollingInterval: (ms: number) => void;
}

const ServicesContext = createContext<ServicesContextValue | null>(null);

export function ServicesProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [groups, setGroups] = useState<ServiceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollingInterval, setPollingIntervalState] = useState(0);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // 刷新服务列表
  const refreshServices = useCallback(async () => {
    try {
      const data = await api.listServices();
      if (isMountedRef.current) {
        setServices(data);
        setError(null);
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        const apiErr = err as { message?: string };
        setError(apiErr.message || "加载服务列表失败");
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // 刷新分组列表
  const refreshGroups = useCallback(async () => {
    try {
      const data = await api.listGroups();
      if (isMountedRef.current) {
        setGroups(data);
      }
    } catch (err: unknown) {
      // 分组功能是可选的，API 可能尚未部署，静默失败
      const apiErr = err as { message?: string; status?: number };
      if (apiErr.status !== 404) {
        console.warn("Failed to load groups:", apiErr.message || err);
      }
      // 保持 groups 为空数组，不影响主要功能
    }
  }, []);

  // 刷新所有数据
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshServices(), refreshGroups()]);
  }, [refreshServices, refreshGroups]);

  // 刷新单个服务并更新列表中的状态
  const refreshService = useCallback(async (id: string): Promise<ServiceDetail | null> => {
    try {
      const detail = await api.getService(id);
      if (isMountedRef.current) {
        // 更新列表中对应服务的状态
        setServices(prev => prev.map(s => 
          s.id === id 
            ? { ...s, state: detail.status.state }
            : s
        ));
      }
      return detail;
    } catch (err) {
      console.error(`Failed to refresh service ${id}:`, err);
      return null;
    }
  }, []);

  // 获取服务状态
  const getServiceState = useCallback((id: string): "running" | "stopped" | "unknown" => {
    const service = services.find(s => s.id === id);
    return service?.state || "unknown";
  }, [services]);

  // 设置轮询间隔
  const setPollingInterval = useCallback((ms: number) => {
    setPollingIntervalState(ms);
  }, []);

  // 初始加载 - 只有在认证完成且已登录后才加载
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      refreshAll();
    } else if (!authLoading && !isAuthenticated) {
      // 未登录时重置状态
      setServices([]);
      setGroups([]);
      setError(null);
      setLoading(false);
    }
  }, [authLoading, isAuthenticated, refreshAll]);

  // 轮询逻辑 - 只有在已登录时才轮询
  useEffect(() => {
    // 清除旧的轮询
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    // 如果间隔 > 0 且已登录，启动轮询
    if (pollingInterval > 0 && isAuthenticated) {
      pollingRef.current = setInterval(() => {
        refreshServices();
      }, pollingInterval);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [pollingInterval, refreshServices, isAuthenticated]);

  // 组件卸载标记
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return (
    <ServicesContext.Provider
      value={{
        services,
        groups,
        loading,
        error,
        refreshServices,
        refreshGroups,
        refreshAll,
        refreshService,
        getServiceState,
        setPollingInterval,
      }}
    >
      {children}
    </ServicesContext.Provider>
  );
}

export function useServices() {
  const context = useContext(ServicesContext);
  if (!context) {
    throw new Error("useServices must be used within a ServicesProvider");
  }
  return context;
}

// 用于在特定页面启用轮询的 hook
export function useServicePolling(intervalMs: number = 5000) {
  const { setPollingInterval } = useServices();
  
  useEffect(() => {
    setPollingInterval(intervalMs);
    return () => setPollingInterval(0);
  }, [intervalMs, setPollingInterval]);
}
