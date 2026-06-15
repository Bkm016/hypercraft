"use client";

import { cn } from "@/utils/cn";

export type ServiceState = "running" | "stopped" | "unknown";

// 服务状态统一配置：圆点色、文案色、文案，全站状态展示共用一处
export const SERVICE_STATE_CONFIG: Record<
  ServiceState,
  { dot: string; text: string; label: string }
> = {
  running: { dot: "bg-success-base", text: "text-success-base", label: "运行中" },
  stopped: { dot: "bg-text-soft-400", text: "text-text-soft-400", label: "已停止" },
  unknown: { dot: "bg-away-base", text: "text-away-base", label: "未知" },
};

interface ServiceStatusDotProps {
  state: ServiceState;
  size?: "sm" | "md";
  className?: string;
}

// 状态圆点：running 叠加呼吸 ping 动效
export function ServiceStatusDot({ state, size = "md", className }: ServiceStatusDotProps) {
  const cfg = SERVICE_STATE_CONFIG[state];
  const sizeCls = size === "sm" ? "size-2" : "size-2.5";
  return (
    <span className={cn("relative inline-flex shrink-0 rounded-full", sizeCls, cfg.dot, className)}>
      {state === "running" && (
        <span className="absolute inset-0 animate-ping rounded-full bg-success-base opacity-40" />
      )}
    </span>
  );
}

interface ServiceStatusBadgeProps {
  state: ServiceState;
  className?: string;
}

// 状态徽标：描边 pill + 圆点 + 文案，用于详情页等需要文字标识的场景
export function ServiceStatusBadge({ state, className }: ServiceStatusBadgeProps) {
  const cfg = SERVICE_STATE_CONFIG[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-stroke-soft-200 bg-bg-white-0 px-2 py-1 text-xs font-medium shadow-regular-xs",
        cfg.text,
        className,
      )}
    >
      <ServiceStatusDot state={state} size="sm" />
      {cfg.label}
    </span>
  );
}
