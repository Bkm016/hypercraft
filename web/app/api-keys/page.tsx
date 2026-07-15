"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RiAddLine, RiKey2Line, RiLoader4Line } from "@remixicon/react";
import * as Button from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import {
  PageLayout,
  PageHeader,
  PageToolbar,
  PageContent,
  PageFooter,
  PageEmpty,
  PageTable,
  PageTableHead,
  PageTableTh,
} from "@/components/layout/page-layout";
import {
  api,
  type ApiKeySummary,
  type CreateApiKeyResponse,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { notification } from "@/hooks/use-notification";
import { CreateApiKeyModal } from "./components/create-api-key-modal";
import { EditApiKeyModal } from "./components/edit-api-key-modal";
import { RevokeApiKeyModal } from "./components/revoke-api-key-modal";
import { SecretRevealModal } from "./components/secret-reveal-modal";
import { ApiKeyRow } from "./components/api-key-row";
import { ApiKeyCard } from "./components/api-key-card";

export default function ApiKeysPage() {
  const router = useRouter();
  const { isSuperAdmin, isLoading: authLoading } = useAuth();
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKeySummary | null>(null);
  const [revokingKey, setRevokingKey] = useState<ApiKeySummary | null>(null);
  const [createdSecret, setCreatedSecret] = useState<CreateApiKeyResponse | null>(null);

  useEffect(() => {
    if (!authLoading && !isSuperAdmin) {
      router.replace("/");
    }
  }, [authLoading, isSuperAdmin, router]);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const keysData = await api.listApiKeys();
      setKeys(keysData);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setError(apiErr.message || "加载 API Key 失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) {
      loadData();
    }
  }, [isSuperAdmin, loadData]);

  const filtered = useMemo(() => {
    if (!search) return keys;
    const q = search.toLowerCase();
    return keys.filter(
      (k) =>
        k.name.toLowerCase().includes(q) ||
        k.key_prefix.toLowerCase().includes(q) ||
        k.scopes.some((s) => s.toLowerCase().includes(q))
    );
  }, [keys, search]);

  const handleCreated = (result: CreateApiKeyResponse) => {
    setShowCreate(false);
    setCreatedSecret(result);
    loadData();
    notification({ status: "success", title: "API Key 已创建" });
  };

  const handleRevoke = async () => {
    if (!revokingKey) return;
    try {
      await api.revokeApiKey(revokingKey.id);
      setRevokingKey(null);
      await loadData();
      notification({ status: "success", title: "API Key 已撤销" });
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      notification({
        status: "error",
        title: apiErr.message || "撤销失败",
      });
    }
  };

  if (authLoading || !isSuperAdmin) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center py-20">
          <RiLoader4Line className="size-8 animate-spin text-text-soft-400" />
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title="API Key"
        description="创建与管理长期 API 密钥"
        actions={
          <Button.Root size="small" onClick={() => setShowCreate(true)}>
            <Button.Icon as={RiAddLine} />
            <span className="hidden sm:inline">创建 Key</span>
          </Button.Root>
        }
      >
        <PageToolbar>
          <SearchField
            variant="toolbar"
            className="min-w-0 flex-1 sm:w-56 sm:flex-none"
            placeholder="搜索名称 / scope…"
            value={search}
            onValueChange={setSearch}
          />
        </PageToolbar>
      </PageHeader>

      <PageContent>
        {loading && keys.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <RiLoader4Line className="size-8 animate-spin text-text-soft-400" />
          </div>
        ) : error ? (
          <PageEmpty
            icon={<RiKey2Line className="size-12" />}
            title="加载失败"
            description={error}
          />
        ) : filtered.length === 0 ? (
          <PageEmpty
            icon={<RiKey2Line className="size-12" />}
            title="还没有 API Key"
            description={
              keys.length === 0 ? "创建一个供 Agent 调用" : "尝试修改搜索条件"
            }
          />
        ) : (
          <>
            <div className="space-y-2 sm:hidden">
              {filtered.map((key) => (
                <ApiKeyCard
                  key={key.id}
                  apiKey={key}
                  onEdit={() => setEditingKey(key)}
                  onRevoke={() => setRevokingKey(key)}
                />
              ))}
            </div>

            <PageTable className="hidden sm:block">
              <PageTableHead>
                <PageTableTh className="w-48">名称</PageTableTh>
                <PageTableTh className="w-40">前缀</PageTableTh>
                <PageTableTh className="w-48">Scopes</PageTableTh>
                <PageTableTh className="w-40">最近使用</PageTableTh>
                <PageTableTh className="w-16" />
              </PageTableHead>
              <tbody>
                {filtered.map((key) => (
                  <ApiKeyRow
                    key={key.id}
                    apiKey={key}
                    onEdit={() => setEditingKey(key)}
                    onRevoke={() => setRevokingKey(key)}
                  />
                ))}
              </tbody>
            </PageTable>
          </>
        )}
      </PageContent>

      <PageFooter>
        <span>共 {filtered.length} 个 API Key</span>
      </PageFooter>

      {showCreate && (
        <CreateApiKeyModal
          onClose={() => setShowCreate(false)}
          onSuccess={handleCreated}
        />
      )}

      {editingKey && (
        <EditApiKeyModal
          apiKey={editingKey}
          onClose={() => setEditingKey(null)}
          onSuccess={() => {
            setEditingKey(null);
            loadData();
          }}
          onRotated={(result) => {
            setEditingKey(null);
            setCreatedSecret(result);
            loadData();
          }}
        />
      )}

      {revokingKey && (
        <RevokeApiKeyModal
          apiKey={revokingKey}
          onClose={() => setRevokingKey(null)}
          onConfirm={handleRevoke}
        />
      )}

      {createdSecret && (
        <SecretRevealModal
          secret={createdSecret.secret}
          name={createdSecret.key.name}
          onClose={() => setCreatedSecret(null)}
        />
      )}
    </PageLayout>
  );
}
