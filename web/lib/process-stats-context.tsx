"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { api, type ProcessStats, type ProcessStatsResponse } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface ProcessStatsContextValue {
  stats: Record<string, ProcessStats>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const ProcessStatsContext = createContext<ProcessStatsContextValue | null>(null);

export function ProcessStatsProvider({ children, pollInterval = 5000 }: { children: ReactNode; pollInterval?: number }) {
  const { isAuthenticated } = useAuth();
  const [stats, setStats] = useState<Record<string, ProcessStats>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const response = await api.getProcessStats();
      setStats(response.processes);
      setError(null);
    } catch (err) {
      const apiErr = err as { message?: string };
      setError(apiErr.message || "获取进程资源失败");
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setStats({});
      setLoading(false);
      return;
    }

    refresh();
    const interval = setInterval(refresh, pollInterval);
    return () => clearInterval(interval);
  }, [isAuthenticated, pollInterval, refresh]);

  return (
    <ProcessStatsContext.Provider value={{ stats, loading, error, refresh }}>
      {children}
    </ProcessStatsContext.Provider>
  );
}

export function useProcessStats() {
  const context = useContext(ProcessStatsContext);
  if (!context) {
    throw new Error("useProcessStats must be used within a ProcessStatsProvider");
  }
  return context;
}

export function useServiceProcessStats(serviceId: string): ProcessStats | null {
  const { stats } = useProcessStats();
  return stats[serviceId] || null;
}
