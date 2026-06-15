import { ReactNode } from "react";
import { cn } from "@/utils/cn";

interface SectionHeaderProps {
  children: ReactNode;
  className?: string;
}

// 小节标题：大写字距标签，分组头/卡片头通用，统一弱标题视觉
export function SectionHeader({ children, className }: SectionHeaderProps) {
  return (
    <h3
      className={cn(
        "truncate text-xs font-medium uppercase tracking-wider text-text-sub-600",
        className,
      )}
    >
      {children}
    </h3>
  );
}
