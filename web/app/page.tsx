"use client";

import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import {
  RiArrowRightLine,
  RiCpuLine,
  RiHardDriveLine,
  RiLoader4Line,
  RiRam2Line,
  RiServerLine,
  RiUserLine,
} from "@remixicon/react";
import * as Button from "@/components/ui/button";
import { PageLayout, PageHeader, PageContent, PageCard } from "@/components/layout/page-layout";
import { ResourceCard } from "@/components/resource-card";
import { StatCard } from "@/components/stat-card";
import { api, type ServiceSummary, type SystemStats } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatBytes } from "@/lib/format";

export default function HomePage() {
  const { isAdmin, isAuthenticated, user } = useAuth();
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isAuthenticated) {
      loadServices();
      loadSystemStats();
      const interval = setInterval(loadSystemStats, 5000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);

  const loadServices = async () => {
    try {
      const data = await api.listServices();
      setServices(data);
    } catch {
      // 忽略错误
    } finally {
      setLoading(false);
    }
  };

  const loadSystemStats = async () => {
    try {
      const data = await api.getSystemStats();
      setSystemStats(data);
    } catch {
      // 忽略错误
    }
  };

  const stats = useMemo(() => ({
    total: services.length,
    running: services.filter((s) => s.state === "running").length,
    stopped: services.filter((s) => s.state === "stopped").length,
  }), [services]);

  const runningServices = useMemo(() => 
    services.filter((s) => s.state === "running").slice(0, 5),
    [services]
  );

  return (
    <PageLayout>
      <PageHeader
        title="仪表盘"
        description={`欢迎回来，${user?.username == "__devtoken__" ? "管理员" :  user?.username ?? "用户"}`}
      />

      <PageContent>
        <div className="space-y-4 sm:space-y-6">
          {/* 统计卡片 */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <StatCard label="全部" value={stats.total} />
            <StatCard
              label="运行中"
              value={stats.running}
              valueClass="text-success-base"
              indicator="bg-success-base"
            />
            <StatCard
              label="已停止"
              value={stats.stopped}
              valueClass="text-text-soft-400"
              indicator="bg-text-soft-400"
            />
          </div>

          {/* 系统资源 */}
          {systemStats && (
            <PageCard title="系统资源">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                <ResourceCard
                  icon={RiCpuLine}
                  label="CPU"
                  value={`${systemStats.cpu_usage.toFixed(1)}%`}
                  usage={systemStats.cpu_usage}
                  color="primary"
                />
                <ResourceCard
                  icon={RiRam2Line}
                  label="内存"
                  value={`${formatBytes(systemStats.memory_used)} / ${formatBytes(systemStats.memory_total)}`}
                  usage={systemStats.memory_usage}
                  color="success"
                />
                <ResourceCard
                  icon={RiHardDriveLine}
                  label="磁盘"
                  value={`${formatBytes(systemStats.disk_used)} / ${formatBytes(systemStats.disk_total)}`}
                  usage={systemStats.disk_usage}
                  color="away"
                />
              </div>
            </PageCard>
          )}

          {/* 运行中的服务 */}
          <PageCard
            title="运行中的服务"
            actions={
              <Button.Root asChild size="xsmall" variant="neutral" mode="ghost">
                <Link href="/services">
                  查看全部
                  <Button.Icon as={RiArrowRightLine} />
                </Link>
              </Button.Root>
            }
          >
            {loading ? (
              <div className="flex items-center justify-center py-6 sm:py-8">
                <RiLoader4Line className="size-5 animate-spin text-text-soft-400" />
              </div>
            ) : runningServices.length > 0 ? (
              <div className="space-y-1.5 sm:space-y-2">
                {runningServices.map((svc) => (
                  <Link
                    key={svc.id}
                    href={`/services/${svc.id}`}
                    className="flex items-center justify-between rounded-lg bg-bg-weak-50 px-3 py-2.5 sm:px-4 sm:py-3 transition-colors hover:bg-bg-soft-200"
                  >
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <span className="size-2 rounded-full bg-success-base shrink-0" />
                      <span className="font-medium text-sm text-text-strong-950 truncate">{svc.name}</span>
                    </div>
                    <span className="text-xs text-text-sub-600 shrink-0 ml-2">
                      运行中
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="py-6 sm:py-8 text-center text-sm text-text-soft-400">
                暂无运行中的服务
              </div>
            )}
          </PageCard>
        </div>
      </PageContent>
    </PageLayout>
  );
}


