"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RiFileCopyLine,
  RiLoader4Line,
  RiPlayLine,
  RiStopLine,
  RiTerminalBoxLine,
} from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as Select from "@/components/ui/select";
import * as Input from "@/components/ui/input";
import * as Switch from "@/components/ui/switch";
import {
  PageLayout,
  PageHeader,
  PageContent,
  PageEmpty,
} from "@/components/layout/page-layout";
import {
  api,
  type ApiKeySummary,
  type ServiceSummary,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { notification } from "@/hooks/use-notification";
import { copyText } from "@/app/api-keys/components/copy-text";
import {
  AGENT_ENDPOINTS,
  SAMPLE_MANIFEST_BODY,
  buildAgentUrl,
  buildCurl,
  maskSecret,
  type AgentEndpointDef,
} from "./agent-endpoints";
import { agentFetch, type AgentFetchResult } from "./lib/agent-fetch";
import { EndpointList } from "./components/endpoint-list";
import { ResponsePanel } from "./components/response-panel";
import { ControlConfirmModal } from "./components/control-confirm-modal";

export default function ApiTestPage() {
  const router = useRouter();
  const { isSuperAdmin, isLoading: authLoading } = useAuth();

  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [secretLoading, setSecretLoading] = useState(false);

  const [endpoint, setEndpoint] = useState<AgentEndpointDef>(AGENT_ENDPOINTS[0]);
  const [serviceId, setServiceId] = useState("");
  const [tail, setTail] = useState(100);
  const [follow, setFollow] = useState(false);
  const [requestBody, setRequestBody] = useState(SAMPLE_MANIFEST_BODY);

  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamBody, setStreamBody] = useState("");
  const [result, setResult] = useState<AgentFetchResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!authLoading && !isSuperAdmin) {
      router.replace("/");
    }
  }, [authLoading, isSuperAdmin, router]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        setLoadError(null);
        const [keysData, servicesData] = await Promise.all([
          api.listApiKeys(),
          api.listServices(),
        ]);
        if (cancelled) return;
        const active = keysData.filter((k) => !k.revoked_at);
        setKeys(active);
        setServices(servicesData);
        setKeyId((prev) => prev || active[0]?.id || "");
        setServiceId((prev) => prev || servicesData[0]?.id || "");
      } catch (err: unknown) {
        if (cancelled) return;
        const apiErr = err as { message?: string };
        setLoadError(apiErr.message || "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  const selectedKey = useMemo(
    () => keys.find((k) => k.id === keyId) || null,
    [keys, keyId]
  );

  // 切换 Key 时取密文；失败清空
  useEffect(() => {
    if (!keyId || !isSuperAdmin) {
      setSecret(null);
      return;
    }
    let cancelled = false;
    setSecretLoading(true);
    setSecret(null);
    setResult(null);
    setStreamBody("");
    api
      .revealApiKeySecret(keyId)
      .then((resp) => {
        if (!cancelled) setSecret(resp.secret);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const apiErr = err as { message?: string };
        notification({
          status: "error",
          title: apiErr.message || "无法读取密钥（旧 Key 请先重置）",
        });
        setSecret(null);
      })
      .finally(() => {
        if (!cancelled) setSecretLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [keyId, isSuperAdmin]);

  const baseUrl = api.getBaseUrl();

  const requestUrl = useMemo(() => {
    return buildAgentUrl(endpoint, {
      baseUrl,
      serviceId,
      tail,
      follow: endpoint.id === "logs" && follow,
    });
  }, [endpoint, baseUrl, serviceId, tail, follow]);

  const wsAttachUrl = useMemo(() => {
    if (endpoint.kind !== "info" || !serviceId.trim()) return "";
    const http = baseUrl.replace(/\/$/, "");
    const ws = http.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
    const token = secret || "";
    return `${ws}/agent/services/${encodeURIComponent(serviceId.trim())}/attach?token=${encodeURIComponent(token)}`;
  }, [endpoint.kind, serviceId, baseUrl, secret]);

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setSending(false);
  }, []);

  const runRequest = useCallback(async () => {
    if (!secret || !selectedKey) {
      notification({ status: "error", title: "请先选择可用的 API Key" });
      return;
    }
    if (endpoint.needsServiceId && !serviceId.trim()) {
      notification({ status: "error", title: "请选择服务 id" });
      return;
    }
    if (endpoint.kind === "info") {
      notification({
        status: "information",
        title: "attach 为 WebSocket，请复制下方连接信息",
      });
      return;
    }
    if (endpoint.needsBody && !requestBody.trim()) {
      notification({ status: "error", title: "请填写 JSON body" });
      return;
    }
    if (endpoint.needsBody) {
      try {
        JSON.parse(requestBody);
      } catch {
        notification({ status: "error", title: "JSON body 格式无效" });
        return;
      }
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSending(true);
    setResult(null);
    setStreamBody("");
    setConfirmOpen(false);

    const isFollow = endpoint.id === "logs" && follow;
    if (isFollow) setStreaming(true);

    const res = await agentFetch({
      method: endpoint.method,
      url: requestUrl,
      secret,
      body: endpoint.needsBody ? requestBody : undefined,
      signal: controller.signal,
      timeoutMs: isFollow ? 0 : 30_000,
      onChunk: isFollow
        ? (chunk) => setStreamBody((prev) => prev + chunk)
        : undefined,
    });

    setResult(res);
    setStreaming(false);
    setSending(false);
    abortRef.current = null;
  }, [secret, selectedKey, endpoint, serviceId, follow, requestUrl, requestBody]);

  const handleSendClick = () => {
    if (endpoint.dangerous) {
      setConfirmOpen(true);
      return;
    }
    void runRequest();
  };

  const handleCopyCurl = async () => {
    if (!secret) {
      notification({ status: "error", title: "密钥未就绪" });
      return;
    }
    if (endpoint.kind === "info") {
      const ok = await copyText(wsAttachUrl);
      notification({
        status: ok ? "success" : "error",
        title: ok ? "已复制 WebSocket URL" : "复制失败",
      });
      return;
    }
    const curl = buildCurl(
      endpoint.method,
      requestUrl,
      secret,
      endpoint.id === "logs" && follow,
      endpoint.needsBody ? requestBody : undefined
    );
    const ok = await copyText(curl);
    notification({
      status: ok ? "success" : "error",
      title: ok ? "已复制 curl" : "复制失败",
    });
  };

  if (authLoading || !isSuperAdmin) {
    return (
      <PageLayout>
        <div className="flex flex-1 items-center justify-center py-20">
          <RiLoader4Line className="size-6 animate-spin text-text-soft-400" />
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title="API 测试"
        description="调试 Agent 接口与权限"
        actions={
          <Button.Root
            variant="neutral"
            mode="stroke"
            size="small"
            onClick={handleCopyCurl}
            disabled={!secret || secretLoading}
          >
            <Button.Icon as={RiFileCopyLine} />
            {endpoint.kind === "info" ? "复制 WS URL" : "复制 curl"}
          </Button.Root>
        }
      />

      <PageContent maxWidth="7xl">
        {loading ? (
          <div className="flex justify-center py-16">
            <RiLoader4Line className="size-6 animate-spin text-text-soft-400" />
          </div>
        ) : loadError ? (
          <PageEmpty title="加载失败" description={loadError} />
        ) : keys.length === 0 ? (
          <PageEmpty
            title="还没有可用的 API Key"
            description="先创建 Key，再回来测试"
            action={
              <Link href="/api-keys">
                <Button.Root variant="primary" mode="filled" size="small">
                  前往 API Key
                </Button.Root>
              </Link>
            }
          />
        ) : (
          <div className="space-y-4">
            {/* 工具条：Key + 服务 */}
            <div className="grid gap-3 rounded-xl border border-stroke-soft-200 bg-bg-white-0 p-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-text-sub-600">
                  API Key
                </span>
                <Select.Root
                  size="medium"
                  value={keyId || undefined}
                  onValueChange={setKeyId}
                >
                  <Select.Trigger>
                    <Select.Value placeholder="选择 API Key" />
                  </Select.Trigger>
                  <Select.Content>
                    {keys.map((k) => (
                      <Select.Item key={k.id} value={k.id}>
                        <span className="truncate">
                          {k.name} · {k.key_prefix}… · {k.scopes.join(",")}
                        </span>
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                <span className="block font-mono text-[11px] text-text-soft-400">
                  {secretLoading
                    ? "读取密钥…"
                    : secret
                      ? maskSecret(secret)
                      : "密钥不可用"}
                </span>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-text-sub-600">
                  服务 id
                </span>
                <Select.Root
                  size="medium"
                  value={
                    services.some((s) => s.id === serviceId)
                      ? serviceId
                      : undefined
                  }
                  onValueChange={setServiceId}
                  disabled={!endpoint.needsServiceId || services.length === 0}
                >
                  <Select.Trigger>
                    <Select.Value
                      placeholder={
                        services.length === 0 ? "无服务" : "选择服务"
                      }
                    />
                  </Select.Trigger>
                  <Select.Content>
                    {services.map((s) => (
                      <Select.Item key={s.id} value={s.id}>
                        <span className="truncate">
                          {s.id}
                          {s.name && s.name !== s.id ? ` · ${s.name}` : ""}
                        </span>
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                {endpoint.needsServiceId && (
                  <Input.Root size="small">
                    <Input.Wrapper>
                      <Input.Input
                        value={serviceId}
                        onChange={(e) => setServiceId(e.target.value)}
                        placeholder="或手输 service id"
                        className="font-mono"
                      />
                    </Input.Wrapper>
                  </Input.Root>
                )}
              </div>
            </div>

            <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
              {/* 左：端点 */}
              <div className="min-w-0 rounded-xl border border-stroke-soft-200 bg-bg-white-0 p-2 md:p-3">
                <p className="mb-2 px-2 text-xs font-medium text-text-sub-600">
                  端点
                </p>
                <EndpointList
                  selectedId={endpoint.id}
                  keyScopes={selectedKey?.scopes ?? null}
                  onSelect={(ep) => {
                    setEndpoint(ep);
                    setResult(null);
                    setStreamBody("");
                    stopStream();
                  }}
                />
              </div>

              {/* 右：请求 + 响应 */}
              <div className="min-w-0 space-y-4">
                <div className="min-w-0 overflow-hidden rounded-xl border border-stroke-soft-200 bg-bg-white-0 p-4">
                  <div className="flex min-w-0 items-start gap-2">
                    <span
                      className={`shrink-0 rounded-md px-2 py-1 font-mono text-xs font-semibold ${
                        endpoint.method === "GET"
                          ? "bg-success-lighter text-success-base"
                          : endpoint.method === "DELETE"
                            ? "bg-error-lighter text-error-base"
                            : endpoint.method === "PUT"
                              ? "bg-information-lighter text-information-base"
                              : "bg-away-lighter text-away-base"
                      }`}
                    >
                      {endpoint.method}
                    </span>
                    <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-text-strong-950">
                      {endpoint.kind === "info"
                        ? (wsAttachUrl || requestUrl).replace(
                            /([?&]token=)[^&]+/,
                            (_, p) => `${p}${secret ? maskSecret(secret) : "…"}`
                          )
                        : requestUrl}
                    </code>
                  </div>

                  {endpoint.needsBody && (
                    <div className="mt-3 space-y-1.5">
                      <span className="text-xs font-medium text-text-sub-600">
                        JSON body（ServiceManifest）
                      </span>
                      <textarea
                        value={requestBody}
                        onChange={(e) => setRequestBody(e.target.value)}
                        rows={10}
                        spellCheck={false}
                        className="w-full resize-y rounded-lg border border-stroke-soft-200 bg-bg-weak-50 p-3 font-mono text-xs leading-relaxed text-text-strong-950 outline-none focus:ring-2 focus:ring-text-strong-950"
                      />
                    </div>
                  )}

                  {endpoint.id === "logs" && (
                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2 text-sm text-text-sub-600">
                        <span>tail</span>
                        <div className="w-24">
                          <Input.Root size="small">
                            <Input.Wrapper>
                              <Input.Input
                                type="number"
                                min={1}
                                max={5000}
                                value={tail}
                                onChange={(e) =>
                                  setTail(
                                    Math.max(1, Number(e.target.value) || 100)
                                  )
                                }
                                className="font-mono"
                              />
                            </Input.Wrapper>
                          </Input.Root>
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-text-sub-600">
                        <Switch.Root
                          checked={follow}
                          onCheckedChange={setFollow}
                        />
                        follow（SSE 流）
                      </label>
                    </div>
                  )}

                  {endpoint.kind === "info" && (
                    <p className="mt-3 flex items-start gap-2 text-xs text-text-sub-600">
                      <RiTerminalBoxLine className="mt-0.5 size-4 shrink-0" />
                      本页不打开 PTY。请用 CLI / 终端客户端连接上方 WebSocket URL（已含
                      token）。
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {streaming || (sending && follow && endpoint.id === "logs") ? (
                      <Button.Root
                        variant="error"
                        mode="filled"
                        size="small"
                        onClick={stopStream}
                      >
                        <Button.Icon as={RiStopLine} />
                        停止
                      </Button.Root>
                    ) : (
                      <Button.Root
                        variant="primary"
                        mode="filled"
                        size="small"
                        onClick={handleSendClick}
                        disabled={
                          !secret ||
                          secretLoading ||
                          sending ||
                          endpoint.kind === "info"
                        }
                      >
                        <Button.Icon as={sending ? RiLoader4Line : RiPlayLine} />
                        {sending
                          ? "发送中…"
                          : endpoint.dangerous
                            ? "发送（需确认）"
                            : "发送"}
                      </Button.Root>
                    )}
                  </div>
                </div>

                <ResponsePanel
                  result={result}
                  streaming={streaming}
                  streamBody={streamBody}
                />
              </div>
            </div>
          </div>
        )}
      </PageContent>

      {confirmOpen && selectedKey && (
        <ControlConfirmModal
          keyName={selectedKey.name}
          actionLabel={endpoint.note}
          serviceId={serviceId.trim() || "—"}
          loading={sending}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => void runRequest()}
        />
      )}
    </PageLayout>
  );
}
