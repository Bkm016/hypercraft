"use client";

import * as Button from "@/components/ui/button";
import Link from "next/link";
import dynamic from "next/dynamic";
import { MobileNav } from "@/components/mobile/mobile-nav";
import { RiLogoutBoxLine, RiUserLine } from "@remixicon/react";
import { useAuth } from "@/lib/auth";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useTheme } from "next-themes";

const DynamicThemeSwitch = dynamic(() => import("./theme-switch"), {
  ssr: false,
});

export default function Header() {
  const pathname = usePathname();
  const { user, isAdmin, logout, isAuthenticated } = useAuth();
  const { resolvedTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // 根据用户权限动态生成导航项
  const navItems: { href: "/services" | "/users"; label: string; adminOnly?: boolean }[] = [
    { href: "/services", label: "服务" },
    { href: "/users", label: "用户", adminOnly: true },
  ];

  // 过滤出当前用户可见的导航项
  const visibleNavItems = navItems.filter(
    (item) => !item.adminOnly || isAdmin
  );

  return (
    <div className="sticky top-0 z-40 border-b border-stroke-soft-200 backdrop-blur supports-backdrop-filter:bg-bg-white-0/80">
      <header className="flex h-14 items-center justify-between px-5">
        <div className="flex items-center gap-3">
          {/* 移动端导航菜单 */}
          {isAuthenticated && (
            <MobileNav open={mobileMenuOpen} onOpenChange={setMobileMenuOpen} />
          )}

          <Link href="/" className="flex items-center">
            <img
              src={resolvedTheme === "dark" ? "/images/icon_white.svg" : "/images/icon_black.svg"}
              alt="Hypercraft"
              className="h-7 w-auto"
            />
          </Link>

          {/* 桌面端导航 */}
          {isAuthenticated && (
            <nav className="hidden items-center gap-1 text-sm text-text-sub-600 md:flex">
              {visibleNavItems.map((item) => {
                const active =
                  pathname === item.href || pathname?.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-lg px-3 py-1.5 transition duration-200 ${
                      active
                        ? "bg-bg-weak-50 font-medium text-text-strong-950"
                        : "hover:bg-bg-weak-50 hover:text-text-strong-950"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>

        <div className="flex items-center gap-3">
          <DynamicThemeSwitch />
          
          {isAuthenticated && user && (
            <>
              <Link 
                href="/profile"
                className="hidden items-center gap-2 border-l border-stroke-soft-200 pl-3 md:flex hover:opacity-80 transition-opacity"
              >
                <div className="flex items-center gap-1.5 text-sm text-text-sub-600">
                  <RiUserLine className="size-4" />
                  {isAdmin ? <span className="rounded bg-away-lighter px-1.5 py-0.5 text-xs font-medium text-away-base">
                    管理员
                  </span> : <span>{user.username}</span>}
                </div>
              </Link>
              <Button.Root
                variant="error"
                mode="ghost"
                size="xsmall"
                onClick={logout}
                title="退出登录"
              >
                <Button.Icon as={RiLogoutBoxLine} />
                <span className="hidden md:inline">退出</span>
              </Button.Root>
            </>
          )}
        </div>
      </header>
    </div>
  );
}
