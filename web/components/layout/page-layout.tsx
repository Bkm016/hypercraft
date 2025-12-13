"use client";

import { ReactNode } from "react";

/**
 * 统一的页面布局系统
 * 
 * 布局类型：
 * - default: 标准页面布局（带顶部标题栏 + 内容区）
 * - centered: 居中内容布局（登录、错误页等）
 * - full: 全屏布局（控制台等需要占满屏幕的页面）
 */

interface PageLayoutProps {
  children: ReactNode;
  /** 布局类型 */
  variant?: "default" | "centered" | "full";
}

interface PageHeaderProps {
  /** 页面标题 */
  title: string;
  /** 副标题/描述 */
  description?: string;
  /** 右侧操作区 */
  actions?: ReactNode;
  /** 标题下方的额外内容（如筛选器、统计信息） */
  children?: ReactNode;
}

interface PageContentProps {
  children: ReactNode;
  /** 内容区最大宽度 */
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "4xl" | "6xl" | "7xl" | "full";
  /** 是否有内边距 */
  padded?: boolean;
  /** 是否填充剩余高度（用于日志、终端等需要自适应高度的组件） */
  fillHeight?: boolean;
}

interface PageToolbarProps {
  children: ReactNode;
}

interface PageFooterProps {
  children: ReactNode;
}

// 最大宽度映射
const maxWidthMap = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "4xl": "max-w-4xl",
  "6xl": "max-w-6xl",
  "7xl": "max-w-7xl",
  full: "max-w-full",
};

/**
 * 页面根布局
 */
export function PageLayout({ children, variant = "default" }: PageLayoutProps) {
  if (variant === "centered") {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg-weak-50 p-6">
        {children}
      </div>
    );
  }

  if (variant === "full") {
    return (
      <div className="flex flex-1 flex-col overflow-hidden bg-bg-weak-50">
        {children}
      </div>
    );
  }

  // default
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-weak-50">
      {children}
    </div>
  );
}

/**
 * 页面头部（标题 + 操作按钮）
 */
export function PageHeader({ title, description, actions, children }: PageHeaderProps) {
  return (
    <div className="z-30 border-b border-stroke-soft-200 bg-bg-white-0">
      <div className="mx-auto max-w-7xl px-4 py-3 md:px-6 md:py-4">
        <div className="flex items-start justify-between gap-3 md:gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-text-strong-950 md:text-xl">{title}</h1>
            {description && (
              <p className="mt-0.5 text-xs text-text-sub-600 md:mt-1 md:text-sm">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * 工具栏（筛选、搜索等）
 */
export function PageToolbar({ children }: PageToolbarProps) {
  return (
    <div className="mt-3 flex flex-col gap-3 md:mt-4 md:flex-row md:items-center md:justify-between md:gap-4">
      {children}
    </div>
  );
}

/**
 * 页面主内容区
 */
export function PageContent({ children, maxWidth = "7xl", padded = true, fillHeight = false }: PageContentProps) {
  const paddingClass = padded ? "px-4 py-4 md:px-6 md:py-6" : "";
  
  if (fillHeight) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className={`mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden ${maxWidthMap[maxWidth]} ${paddingClass}`}
        >
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-auto">
      <div
        className={`mx-auto ${maxWidthMap[maxWidth]} ${paddingClass}`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * 页面底部状态栏
 */
export function PageFooter({ children }: PageFooterProps) {
  return (
    <div className="border-t border-stroke-soft-200 bg-bg-white-0">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 text-xs text-text-sub-600 md:px-6">
        {children}
      </div>
    </div>
  );
}

/**
 * 内容卡片
 */
export function PageCard({
  children,
  title,
  description,
  actions,
  noPadding = false,
  className = "",
  fillHeight = false,
}: {
  children: ReactNode;
  title?: string;
  description?: string;
  actions?: ReactNode;
  noPadding?: boolean;
  className?: string;
  /** 是否填充剩余高度 */
  fillHeight?: boolean;
}) {
  const cardClass = fillHeight 
    ? `flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-stroke-soft-200 bg-bg-white-0 ${className}`
    : `rounded-xl border border-stroke-soft-200 bg-bg-white-0 ${className}`;
  
  const contentClass = fillHeight
    ? `flex min-h-0 flex-1 flex-col overflow-hidden ${noPadding ? "" : "p-5"}`
    : noPadding ? "" : "p-5";

  return (
    <div className={cardClass}>
      {(title || actions) && (
        <div className="flex shrink-0 items-center justify-between border-b border-stroke-soft-200 px-5 py-3">
          <div>
            {title && (
              <h3 className="font-medium text-text-strong-950 pt-1">{title}</h3>
            )}
            {description && (
              <p className="mt-0.5 text-sm text-text-sub-600">{description}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={contentClass}>{children}</div>
    </div>
  );
}

/**
 * 数据表格容器
 */
export function PageTable({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-stroke-soft-200 bg-bg-white-0 overflow-hidden ${className}`}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

/**
 * 表格头部
 */
export function PageTableHead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-stroke-soft-200 bg-bg-weak-50 text-left text-xs font-medium uppercase tracking-wider text-text-sub-600">
        {children}
      </tr>
    </thead>
  );
}

/**
 * 表格头单元格
 */
export function PageTableTh({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <th className={`px-4 py-3 ${className}`}>{children}</th>;
}

/**
 * 空状态
 */
export function PageEmpty({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && (
        <div className="mb-4 text-text-soft-400">{icon}</div>
      )}
      <h3 className="text-base font-medium text-text-strong-950">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-text-sub-600">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
