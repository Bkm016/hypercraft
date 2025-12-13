// 移动端导航菜单组件

"use client";

import * as CompactButton from "@/components/ui/compact-button";
import * as SideDrawer from "./side-drawer";
import Link from "next/link";
import { RiMenuLine, RiUserLine } from "@remixicon/react";
import { useAuth } from "@/lib/auth";
import { usePathname } from "next/navigation";

interface NavItem {
  href: "/services" | "/users" | "/profile";
  label: string;
  adminOnly?: boolean;
}

interface MobileNavProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MobileNav({ open, onOpenChange }: MobileNavProps) {
  const pathname = usePathname();
  const { user, isAdmin } = useAuth();

  const navItems: NavItem[] = [
    { href: "/services", label: "服务" },
    { href: "/users", label: "用户", adminOnly: true },
  ];

  const visibleNavItems = navItems.filter(
    (item) => !item.adminOnly || isAdmin
  );

  const handleLinkClick = () => {
    onOpenChange(false);
  };

  return (
    <SideDrawer.Root open={open} onOpenChange={onOpenChange}>
      <SideDrawer.Trigger asChild>
        <CompactButton.Root variant="ghost" size="medium" className="md:hidden">
          <CompactButton.Icon as={RiMenuLine} />
        </CompactButton.Root>
      </SideDrawer.Trigger>
      <SideDrawer.Content>
        <SideDrawer.Header>
          <SideDrawer.Title>导航菜单</SideDrawer.Title>
        </SideDrawer.Header>
        <SideDrawer.Body className="p-4">
          <nav className="flex flex-col gap-1">
            {visibleNavItems.map((item) => {
              const active =
                pathname === item.href || pathname?.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={handleLinkClick}
                  className={`rounded-lg px-3 py-2.5 text-sm transition duration-200 ${
                    active
                      ? "bg-bg-weak-50 font-medium text-text-strong-950"
                      : "text-text-sub-600 hover:bg-bg-weak-50 hover:text-text-strong-950"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {user && (
            <div className="mt-4 border-t border-stroke-soft-200 pt-4">
              <Link
                href="/profile"
                onClick={handleLinkClick}
                className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-text-sub-600 hover:bg-bg-weak-50 hover:text-text-strong-950"
              >
                <RiUserLine className="size-4" />
                <span>{user.username}</span>
                {isAdmin && (
                  <span className="rounded bg-away-lighter px-1.5 py-0.5 text-xs font-medium text-away-base">
                    管理员
                  </span>
                )}
              </Link>
            </div>
          )}
        </SideDrawer.Body>
      </SideDrawer.Content>
    </SideDrawer.Root>
  );
}
