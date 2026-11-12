"use client";

import type { ComponentType, ReactNode } from "react";
import * as Tooltip from "@/components/ui/tooltip";
import { cn } from "@/utils/cn";

/** 工作区内的图标按钮：颜色来自 --ws-* 主题变量，自带 Tooltip */
export function IconButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  active,
  className,
  iconClassName,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--ws-muted)] outline-none transition-colors duration-150",
            "hover:bg-[var(--ws-hover)] hover:text-[var(--ws-fg)]",
            "focus-visible:ring-2 focus-visible:ring-[var(--ws-accent)]/40",
            "disabled:pointer-events-none disabled:opacity-35",
            active && "bg-[var(--ws-hover)] text-[var(--ws-fg)]",
            className,
          )}
        >
          <Icon className={cn("size-4", iconClassName)} />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip.Root>
  );
}

/** 底部状态栏（文件树与编辑器共用，保持等高对齐） */
export function StatusBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 border-t border-[var(--ws-border)] bg-[var(--ws-panel)] px-3 text-xs text-[var(--ws-muted)] md:px-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 工具栏分隔线 */
export function ToolbarDivider() {
  return <span className="mx-1 h-4 w-px shrink-0 bg-[var(--ws-border)]" aria-hidden />;
}
