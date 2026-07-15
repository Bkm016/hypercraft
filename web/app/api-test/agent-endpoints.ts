import type { ApiKeyScope } from "@/lib/api";

export type AgentEndpointKind = "json" | "text" | "sse" | "info";

export type PathParamPicker = "service" | "group";

export interface PathParamDef {
  key: "id";
  label: string;
  picker: PathParamPicker;
}

export type BodyTemplateKey =
  | "serviceManifest"
  | "createGroup"
  | "updateGroup"
  | "reorderGroups"
  | "assignGroup";

export interface AgentEndpointDef {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  scope: ApiKeyScope | null;
  note: string;
  kind: AgentEndpointKind;
  bodyTemplate?: BodyTemplateKey;
  dangerous?: boolean;
}

/** 按路径推断 :id 绑定服务还是分组，避免每个端点重复写字段 */
export function resolvePathParams(path: string): PathParamDef[] {
  if (!path.includes(":id")) {
    return [];
  }
  const picker: PathParamPicker =
    path.startsWith("/agent/groups") || path.startsWith("/groups/")
      ? "group"
      : "service";
  return [
    {
      key: "id",
      label: picker === "group" ? "分组 id" : "服务 id",
      picker,
    },
  ];
}

export function endpointNeedsPathParam(endpoint: AgentEndpointDef): boolean {
  return resolvePathParams(endpoint.path).length > 0;
}

export const BODY_TEMPLATES: Record<BodyTemplateKey, string> = {
  serviceManifest: `{
  "id": "demo-svc",
  "name": "Demo Service",
  "command": "echo",
  "args": ["hello"],
  "auto_start": false,
  "auto_restart": false
}`,
  createGroup: `{
  "id": "default",
  "name": "Default",
  "color": "#5B8DEF"
}`,
  updateGroup: `{
  "name": "Default",
  "color": "#5B8DEF"
}`,
  reorderGroups: `{
  "group_ids": ["default"]
}`,
  assignGroup: `{
  "group": "default"
}`,
};

/** 机器可读端点清单；路径参数与 body 模板由规则推导 */
export const AGENT_ENDPOINTS: AgentEndpointDef[] = [
  {
    id: "me",
    method: "GET",
    path: "/agent/me",
    scope: null,
    note: "当前身份",
    kind: "json",
  },
  {
    id: "help",
    method: "GET",
    path: "/agent/help",
    scope: null,
    note: "能力说明",
    kind: "json",
  },
  {
    id: "list",
    method: "GET",
    path: "/agent/services",
    scope: "read",
    note: "可见服务列表",
    kind: "json",
  },
  {
    id: "create",
    method: "POST",
    path: "/agent/services",
    scope: "manage",
    note: "创建服务",
    kind: "json",
    bodyTemplate: "serviceManifest",
    dangerous: true,
  },
  {
    id: "get",
    method: "GET",
    path: "/agent/services/:id",
    scope: "read",
    note: "manifest + status",
    kind: "json",
  },
  {
    id: "update",
    method: "PUT",
    path: "/agent/services/:id",
    scope: "manage",
    note: "更新服务定义",
    kind: "json",
    bodyTemplate: "serviceManifest",
    dangerous: true,
  },
  {
    id: "delete",
    method: "DELETE",
    path: "/agent/services/:id",
    scope: "manage",
    note: "删除服务",
    kind: "json",
    dangerous: true,
  },
  {
    id: "assign-group",
    method: "PATCH",
    path: "/services/:id/group",
    scope: "manage",
    note: "分配服务到分组（group=null 解除）",
    kind: "json",
    bodyTemplate: "assignGroup",
    dangerous: true,
  },
  {
    id: "status",
    method: "GET",
    path: "/agent/services/:id/status",
    scope: "read",
    note: "运行状态",
    kind: "json",
  },
  {
    id: "start",
    method: "POST",
    path: "/agent/services/:id/start",
    scope: "control",
    note: "启动",
    kind: "json",
    dangerous: true,
  },
  {
    id: "stop",
    method: "POST",
    path: "/agent/services/:id/stop",
    scope: "control",
    note: "停止",
    kind: "json",
    dangerous: true,
  },
  {
    id: "restart",
    method: "POST",
    path: "/agent/services/:id/restart",
    scope: "control",
    note: "重启",
    kind: "json",
    dangerous: true,
  },
  {
    id: "shutdown",
    method: "POST",
    path: "/agent/services/:id/shutdown",
    scope: "control",
    note: "优雅关闭",
    kind: "json",
    dangerous: true,
  },
  {
    id: "kill",
    method: "POST",
    path: "/agent/services/:id/kill",
    scope: "control",
    note: "强杀",
    kind: "json",
    dangerous: true,
  },
  {
    id: "logs",
    method: "GET",
    path: "/agent/services/:id/logs",
    scope: "logs",
    note: "日志 tail / follow",
    kind: "text",
  },
  {
    id: "attach",
    method: "GET",
    path: "/agent/services/:id/attach",
    scope: "attach",
    note: "WebSocket PTY（本页仅展示连接信息）",
    kind: "info",
  },
  {
    id: "groups-list",
    method: "GET",
    path: "/agent/groups",
    scope: "read",
    note: "分组列表",
    kind: "json",
  },
  {
    id: "groups-create",
    method: "POST",
    path: "/agent/groups",
    scope: "manage",
    note: "创建分组",
    kind: "json",
    bodyTemplate: "createGroup",
    dangerous: true,
  },
  {
    id: "groups-reorder",
    method: "POST",
    path: "/agent/groups/reorder",
    scope: "manage",
    note: "重排分组",
    kind: "json",
    bodyTemplate: "reorderGroups",
    dangerous: true,
  },
  {
    id: "groups-update",
    method: "PATCH",
    path: "/agent/groups/:id",
    scope: "manage",
    note: "更新分组",
    kind: "json",
    bodyTemplate: "updateGroup",
    dangerous: true,
  },
  {
    id: "groups-delete",
    method: "DELETE",
    path: "/agent/groups/:id",
    scope: "manage",
    note: "删除分组",
    kind: "json",
    dangerous: true,
  },
];

export interface BuildUrlOptions {
  baseUrl: string;
  serviceId?: string;
  groupId?: string;
  tail?: number;
  follow?: boolean;
}

function pickPathId(path: string, serviceId: string, groupId: string): string {
  const params = resolvePathParams(path);
  if (params.length === 0) {
    return "";
  }
  return params[0].picker === "group" ? groupId : serviceId;
}

/** 拼出完整请求 URL（含 query） */
export function buildAgentUrl(
  endpoint: AgentEndpointDef,
  opts: BuildUrlOptions
): string {
  let path = endpoint.path;
  const id = pickPathId(
    path,
    (opts.serviceId || "").trim(),
    (opts.groupId || "").trim()
  );
  if (path.includes(":id")) {
    path = path.replace(
      ":id",
      id ? encodeURIComponent(id) : ":id"
    );
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

export function defaultBodyForEndpoint(endpoint: AgentEndpointDef): string {
  if (!endpoint.bodyTemplate) {
    return "";
  }
  return BODY_TEMPLATES[endpoint.bodyTemplate];
}

export function bodyTemplateLabel(key: BodyTemplateKey): string {
  const labels: Record<BodyTemplateKey, string> = {
    serviceManifest: "ServiceManifest",
    createGroup: "CreateGroup",
    updateGroup: "UpdateGroup",
    reorderGroups: "ReorderGroups",
    assignGroup: "AssignGroup",
  };
  return labels[key];
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

/** @deprecated 使用 BODY_TEMPLATES.serviceManifest */
export const SAMPLE_MANIFEST_BODY = BODY_TEMPLATES.serviceManifest;