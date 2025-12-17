"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { notification } from "@/hooks/use-notification";
import {
  RiAddLine,
  RiDeleteBinLine,
  RiLoader4Line,
  RiSearchLine,
  RiUserLine,
} from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as Checkbox from "@/components/ui/checkbox";
import * as CompactButton from "@/components/ui/compact-button";
import * as Input from "@/components/ui/input";
import * as Tooltip from "@/components/ui/tooltip";
import { CreateUserModal } from "./components/create-user-modal";
import { DeleteUserModal } from "./components/delete-user-modal";
import { EditUserModal } from "./components/edit-user-modal";
import { PageLayout, PageHeader, PageToolbar, PageContent, PageFooter, PageTable, PageTableHead, PageTableTh, PageEmpty } from "@/components/layout/page-layout";
import { UserCard } from "./components/user-card";
import { UserRow } from "./components/user-row";
import { api, type UserSummary, type ServiceSummary, type ServiceGroup } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function UsersPage() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [groups, setGroups] = useState<ServiceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  
  // 弹窗状态
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserSummary | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserSummary | null>(null);

  // 加载数据
  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [usersData, servicesData, groupsData] = await Promise.all([
        api.listUsers(),
        api.listServices(),
        api.listGroups(),
      ]);
      setUsers(usersData);
      setServices(servicesData);
      setGroups(groupsData);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setError(apiErr.message || "加载用户列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 删除用户
  const handleDeleteUser = async (user: UserSummary) => {
    try {
      await api.deleteUser(user.id);
      await loadData();
      setDeletingUser(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(user.id);
        return next;
      });
      notification({ status: "success", title: "用户已删除" });
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      notification({
        status: "error",
        title: apiErr.message || "删除用户失败",
      });
    }
  };

  // 批量删除
  const handleBatchDelete = async () => {
    const ids = Array.from(selected);
    for (const id of ids) {
      try {
        await api.deleteUser(id);
      } catch {
        // 继续删除其他用户
      }
    }
    await loadData();
    setSelected(new Set());
  };

  const filteredUsers = useMemo(() => {
    if (!search) return users;
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.service_ids.some((s) => s.toLowerCase().includes(q))
    );
  }, [users, search]);

  const allSelected = filteredUsers.length > 0 && filteredUsers.every((u) => selected.has(u.id));
  const someSelected = filteredUsers.some((u) => selected.has(u.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredUsers.map((u) => u.id)));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  };

  return (
    <PageLayout>
      <PageHeader
        title="用户管理"
        description="管理系统用户和访问权限"
        actions={
          isAdmin && (
            <Button.Root size="small" onClick={() => setShowCreateModal(true)}>
              <Button.Icon as={RiAddLine} />
              <span className="hidden sm:inline">添加用户</span>
            </Button.Root>
          )
        }
      >
        <PageToolbar>
          <Input.Root size="small" className="flex-1 sm:flex-none sm:w-64">
            <Input.Wrapper>
              <Input.Icon as={RiSearchLine} />
              <Input.Input
                type="text"
                placeholder="搜索用户..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Input.Wrapper>
          </Input.Root>

          {selected.size > 0 && isAdmin && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm text-text-sub-600 hidden sm:inline">已选 {selected.size} 项</span>
              <span className="text-xs text-text-sub-600 sm:hidden">{selected.size}</span>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <CompactButton.Root
                    variant="ghost"
                    onClick={handleBatchDelete}
                    className="hover:bg-error-lighter hover:text-error-base text-error-base"
                  >
                    <CompactButton.Icon as={RiDeleteBinLine} />
                  </CompactButton.Root>
                </Tooltip.Trigger>
                <Tooltip.Content>删除选中</Tooltip.Content>
              </Tooltip.Root>
            </div>
          )}
        </PageToolbar>
      </PageHeader>

      <PageContent>
        {loading && users.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <RiLoader4Line className="size-8 animate-spin text-text-soft-400" />
          </div>
        ) : error ? (
          <PageEmpty
            icon={<RiUserLine className="size-12" />}
            title="加载失败"
            description={error}
          />
        ) : filteredUsers.length === 0 ? (
          <PageEmpty
            icon={<RiUserLine className="size-12" />}
            title="没有找到用户"
            description={users.length === 0 ? "还没有创建任何用户" : "尝试修改搜索条件"}
          />
        ) : (
          <>
            {/* 移动端：卡片列表 */}
            <div className="sm:hidden space-y-2">
              {filteredUsers.map((user) => (
                <UserCard
                  key={user.id}
                  user={user}
                  selected={selected.has(user.id)}
                  isAdmin={isAdmin}
                  onToggle={() => toggleOne(user.id)}
                  onEdit={() => setEditingUser(user)}
                  onDelete={() => setDeletingUser(user)}
                />
              ))}
            </div>

            {/* 桌面端：表格 */}
            <PageTable className="hidden sm:block">
              <PageTableHead>
                <PageTableTh className="w-10">
                  <Checkbox.Root
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                  />
                </PageTableTh>
                <PageTableTh className="w-48">用户名</PageTableTh>
                <PageTableTh className="w-64">服务权限</PageTableTh>
                <PageTableTh className="w-32">双因素认证</PageTableTh>
                <PageTableTh className="w-50">创建时间</PageTableTh>
                <PageTableTh className="w-24" />
              </PageTableHead>
              <tbody>
                {filteredUsers.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    selected={selected.has(user.id)}
                    isAdmin={isAdmin}
                    onToggle={() => toggleOne(user.id)}
                    onEdit={() => setEditingUser(user)}
                    onDelete={() => setDeletingUser(user)}
                  />
                ))}
              </tbody>
            </PageTable>
          </>
        )}
      </PageContent>

      <PageFooter>
        <span>共 {filteredUsers.length} 个用户</span>
      </PageFooter>

      {/* 创建用户弹窗 */}
      {showCreateModal && (
        <CreateUserModal
          services={services}
          groups={groups}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            loadData();
          }}
        />
      )}

      {/* 编辑用户弹窗 */}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          services={services}
          groups={groups}
          onClose={() => setEditingUser(null)}
          onSuccess={() => {
            setEditingUser(null);
            loadData();
          }}
        />
      )}

      {/* 删除确认弹窗 */}
      {deletingUser && (
        <DeleteUserModal
          user={deletingUser}
          onClose={() => setDeletingUser(null)}
          onConfirm={() => handleDeleteUser(deletingUser)}
        />
      )}
    </PageLayout>
  );
}

