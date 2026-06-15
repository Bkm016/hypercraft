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
    <div className="sticky top-0 z-40 border-b border-stroke-soft-200 bg-bg-white-0/80 backdrop-blur-md supports-[backdrop-filter]:bg-bg-white-0/70">
      <header className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 md:px-6">
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
            <nav className="ml-2 hidden items-center gap-6 md:flex">
              {visibleNavItems.map((item) => {
                const active =
                  pathname === item.href || pathname?.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`relative flex h-14 items-center text-sm font-medium transition-colors ${
                      active
                        ? "text-text-strong-950 after:absolute after:-bottom-px after:left-0 after:h-0.5 after:w-full after:rounded-full after:bg-text-strong-950"
                        : "text-text-sub-600 hover:text-text-strong-950"
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
                className="hidden items-center gap-2 rounded-lg border border-stroke-soft-200 bg-bg-white-0 px-2.5 py-1.5 text-sm text-text-sub-600 shadow-regular-xs transition-colors hover:bg-bg-weak-50 hover:text-text-strong-950 md:flex"
              >
                <RiUserLine className="size-4 shrink-0" />
                {isAdmin ? (
                  <span className="rounded-md bg-away-lighter px-1.5 py-0.5 text-xs font-medium text-away-base">
                    管理员
                  </span>
                ) : (
                  <span className="font-medium">{user.username}</span>
                )}
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
