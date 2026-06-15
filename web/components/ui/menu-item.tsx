"use client";

import * as React from "react";
import type { RemixiconComponentType } from "@remixicon/react";
import { cn } from "@/utils/cn";

export interface MenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: RemixiconComponentType;
  /** 危险操作（删除等）使用错误色 */
  destructive?: boolean;
}

// 弹层/菜单内的操作行：统一图标 + 文案 + hover 态，替代各处重复的内联按钮
export const MenuItem = React.forwardRef<HTMLButtonElement, MenuItemProps>(function MenuItem(
  { icon: Icon, destructive, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
        destructive
          ? "text-error-base hover:bg-error-lighter"
          : "text-text-sub-600 hover:bg-bg-weak-50 hover:text-text-strong-950",
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      {children}
    </button>
  );
});
