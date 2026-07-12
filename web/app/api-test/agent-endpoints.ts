import type { ApiKeyScope } from "@/lib/api";

export type AgentEndpointKind = "json" | "text" | "sse" | "info";

export interface AgentEndpointDef {
  id: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** 含 :id 占位 */
  path: string;
  scope: ApiKeyScope | null;
  note: string;
  needsServiceId: boolean;
  kind: AgentEndpointKind;
  /** 需要 JSON body（create/update） */
  needsBody?: boolean;
  /** control / manage 写操作需二次确认 */
  dangerous?: boolean;
}

export const AGENT_ENDPOINTS: AgentEndpointDef[] = [
  {
    id: "me",
    method: "GET",
    path: "/agent/me",
    scope: null,
    note: "当前身份",
    needsServiceId: false,
    kind: "json",
  },
  {
    id: "help",
    method: "GET",
    path: "/agent/help",
    scope: null,
    note: "能力说明",
    needsServiceId: false,
    kind: "json",
  },
  {
    id: "list",
    method: "GET",
    path: "/agent/services",
    scope: "read",
    note: "可见服务列表",
    needsServiceId: false,
    kind: "json",
  },
  {
    id: "create",
    method: "POST",
    path: "/agent/services",
    scope: "manage",
    note: "创建服务",
    needsServiceId: false,
    kind: "json",
    needsBody: true,
    dangerous: true,
  },
  {
    id: "get",
    method: "GET",
    path: "/agent/services/:id",
    scope: "read",
    note: "manifest + status",
    needsServiceId: true,
    kind: "json",
  },
  {
    id: "update",
    method: "PUT",
    path: "/agent/services/:id",
    scope: "manage",
    note: "更新服务定义",
    needsServiceId: true,
    kind: "json",
    needsBody: true,
    dangerous: true,
  },
  {
    id: "delete",
    method: "DELETE",
    path: "/agent/services/:id",
    scope: "manage",
    note: "删除服务",
    needsServiceId: true,
    kind: "json",
    dangerous: true,
  },
  {
    id: "status",
    method: "GET",
    path: "/agent/services/:id/status",
    scope: "read",
    note: "运行状态",
    needsServiceId: true,
    kind: "json",
  },
  {
    id: "start",
    method: "POST",
    path: "/agent/services/:id/start",
    scope: "control",
    note: "启动",
    needsServiceId: true,
    kind: "json",
    dangerous: true,
  },
  {
    id: "stop",
    method: "POST",
    path: "/agent/services/:id/stop",
    scope: "control",
    note: "停止",
    needsServiceId: true,
    kind: "json",
    dangerous: true,
  },
  {
    id: "restart",
    method: "POST",
    path: "/agent/services/:id/restart",
    scope: "control",
    note: "重启",
    needsServiceId: true,
    kind: "json",
    dangerous: true,
  },
  {
    id: "shutdown",
    method: "POST",
    path: "/agent/services/:id/shutdown",
    scope: "control",
    note: "优雅关闭",
    needsServiceId: true,
    kind: "json",
    dangerous: true,
  },
  {
    id: "kill",
    method: "POST",
    path: "/agent/services/:id/kill",
    scope: "control",
    note: "强杀",
    needsServiceId: true,
    kind: "json",
    dangerous: true,
  },
  {
    id: "logs",
    method: "GET",
    path: "/agent/services/:id/logs",
    scope: "logs",
    note: "日志 tail / follow",
    needsServiceId: true,
    kind: "text",
  },
  {
    id: "attach",
    method: "GET",
    path: "/agent/services/:id/attach",
    scope: "attach",
    note: "WebSocket PTY（本页仅展示连接信息）",
    needsServiceId: true,
    kind: "info",
  },
];

export interface BuildUrlOptions {
  baseUrl: string;
  serviceId?: string;
  tail?: number;
  follow?: boolean;
}

/** 拼出完整请求 URL（含 query） */
export function buildAgentUrl(
  endpoint: AgentEndpointDef,
  opts: BuildUrlOptions
): string {
  let path = endpoint.path;
  if (endpoint.needsServiceId) {
    const id = (opts.serviceId || "").trim();
    path = path.replace(":id", id ? encodeURIComponent(id) : ":id");
  }

  const url = new URL(path, opts.baseUrl.replace(/\/$/, "") + "/");

  if (endpoint.id === "logs") {
    url.searchParams.set("tail", String(opts.tail ?? 100));
    if (opts.follow) {
      url.searchParams.set("follow", "true");
    }
  }

  return url.toString();
}

/** 掩码展示密钥 */
export function maskSecret(secret: string): string {
  if (secret.length <= 16) return "••••••••";
  return `${secret.slice(0, 12)}…${secret.slice(-4)}`;
}

export function buildCurl(
  method: string,
  url: string,
  secret: string,
  follow: boolean,
  body?: string
): string {
  const parts = [`curl`];
  if (follow) parts.push("-N");
  if (method !== "GET") parts.push(`-X ${method}`);
  parts.push(`-H "Authorization: Bearer ${secret}"`);
  if (body && body.trim()) {
    parts.push(`-H "Content-Type: application/json"`);
    parts.push(`-d ${JSON.stringify(body)}`);
  }
  parts.push(`"${url}"`);
  return parts.join(" ");
}

/** create/update 示例 body */
export const SAMPLE_MANIFEST_BODY = `{
  "id": "demo-svc",
  "name": "Demo Service",
  "command": "echo",
  "args": ["hello"],
  "auto_start": false,
  "auto_restart": false
}`;
