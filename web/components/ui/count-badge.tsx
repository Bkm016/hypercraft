import { cn } from "@/utils/cn";

interface CountBadgeProps {
  /** 主数值（如运行中数量） */
  value: number;
  /** 可选总数，传入时展示为 "value / total" */
  total?: number;
  className?: string;
}

// 数字计数标：tabular-nums 对齐，用于"运行/总数""Tab 计数"等场景
export function CountBadge({ value, total, className }: CountBadgeProps) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs tabular-nums", className)}>
      <span className="font-medium text-text-strong-950">{value}</span>
      {total !== undefined && <span className="text-text-soft-400">/ {total}</span>}
    </span>
  );
}
