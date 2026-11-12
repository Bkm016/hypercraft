import type {
  AuthToken,
  LoginRequest,
  DevTokenLoginRequest,
  RefreshRequest,
  UserSummary,
  CreateUserRequest,
  UpdateUserRequest,
  ChangePasswordRequest,
  ApiKeySummary,
  ApiKeySecretResponse,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  UpdateApiKeyRequest,
  Runtime,
  JavaCatalog,
  RuntimeDownloadSettings,
  InstallTask,
  ToolListResponse,
  ToolVersions,
  RuntimeStorage,
  CleanupResult,
  ServiceSummary,
  ServiceManifest,
  ServiceDetail,
  ServiceStatus,
  ServiceGroup,
  CreateGroupRequest,
  UpdateGroupRequest,
  ReorderServicesRequest,
  ApiError,
  ScheduleResponse,
  UpdateScheduleRequest,
  ValidateCronRequest,
  ValidateCronResponse,
  SystemStats,
  Setup2FARequest,
  Setup2FAResponse,
  Enable2FARequest,
  Disable2FARequest,
  WebSessionResponse,
  DirListing,
  FileContent,
  FileEntry,
  WriteFileResponse,
  InitUploadRequest,
  TextEncoding,
  InitUploadResponse,
  UploadStatus,
} from "./types";

/**
 * 支持相对路径（如 "/api"）：在浏览器中基于当前页面 Origin 解析为绝对地址，
 * 便于同源反代部署（1Panel 等），WebSocket 地址也由此正确推导。
 */
function resolveApiBaseUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, "");
  if (typeof window !== "undefined" && value.startsWith("/")) {
    return `${window.location.origin}${value}`;
  }
  return value;
}

function getApiBaseUrl(): string {
  // Runtime config takes precedence (from public/config.js)
  if (typeof window !== "undefined" && window.__RUNTIME_CONFIG__?.apiUrl) {
    return resolveApiBaseUrl(window.__RUNTIME_CONFIG__.apiUrl);
  }
  // Fallback to build-time env or default
  return resolveApiBaseUrl(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080");
}

export const SESSION_EXPIRES_AT_KEY = "hc_session_expires_at";
const SESSION_REFRESHED_AT_KEY = "hc_session_refreshed_at";
const SESSION_REFRESH_LOCK = "hc_session_refresh";
export const SESSION_INVALID_EVENT = "hypercraft:session-invalid";

class ApiClient {
  /** 最近一次登录/刷新返回的 access 过期时间（unix 秒），仅用于 UI 展示 */
  private sessionExpiresAt: number | null = null;
  private refreshPromise: Promise<void> | null = null;
  /** 是否已有浏览器会话（cookie），避免在未登录时对 /auth/me 无意义重试 */
  private hasSessionHint = false;

  getBaseUrl(): string {
    return getApiBaseUrl();
  }

  // ==================== Token / 会话管理 ====================

  /**
   * 登录/刷新成功后记录会话元数据。
   * access/refresh token 由后端 HttpOnly cookie 持有，不再写入 localStorage。
   */
  setSession(tokens: AuthToken) {
    this.hasSessionHint = true;
    this.sessionExpiresAt =
      Math.floor(Date.now() / 1000) + (tokens.expires_in || 0);
    if (typeof window !== "undefined") {
      // 仅跨标签同步会话时间，不向 JS 存储暴露任何 token。
      localStorage.setItem(SESSION_EXPIRES_AT_KEY, String(this.sessionExpiresAt));
      localStorage.setItem(SESSION_REFRESHED_AT_KEY, String(Date.now()));
    }
  }

  clearSession() {
    this.hasSessionHint = false;
    this.sessionExpiresAt = null;
    if (typeof window !== "undefined") {
      // 清理历史 localStorage 残留，防止旧版本 token 继续暴露
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      localStorage.removeItem(SESSION_EXPIRES_AT_KEY);
      localStorage.removeItem(SESSION_REFRESHED_AT_KEY);
    }
  }

  invalidateSession() {
    this.clearSession();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(SESSION_INVALID_EVENT));
    }
  }

  /** @deprecated 浏览器会话不再向 JS 暴露 access token */
  setTokens(tokens: AuthToken) {
    this.setSession(tokens);
  }

  /** @deprecated 使用 clearSession / logout */
  clearTokens() {
    this.clearSession();
  }

  isAuthenticated(): boolean {
    return this.hasSessionHint;
  }

  markSessionHint(active: boolean) {
    this.hasSessionHint = active;
  }

  getSessionExpiresAt(): number | null {
    if (typeof window !== "undefined") {
      const storedExpiresAt = Number(localStorage.getItem(SESSION_EXPIRES_AT_KEY));
      if (Number.isFinite(storedExpiresAt) && storedExpiresAt > 0) {
        this.sessionExpiresAt = storedExpiresAt;
      }
    }
    return this.sessionExpiresAt;
  }

  /**
   * 浏览器会话走 HttpOnly cookie，JS 无法读取 access token。
   * 保留方法签名以兼容旧调用；始终返回 null。
   */
  getAccessToken(): string | null {
    return null;
  }

  /**
   * 浏览器会话走 HttpOnly cookie，JS 无法读取 refresh token。
   */
  getRefreshToken(): string | null {
    return null;
  }

  // ==================== 请求方法 ====================

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    allowRefresh = true
  ): Promise<T> {
    const url = `${getApiBaseUrl()}${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Hypercraft-CSRF": "1",
      ...(options.headers as Record<string, string>),
    };

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });

    // 401 时尝试用 refresh cookie 续期后重试
    if (response.status === 401 && allowRefresh) {
      try {
        await this.refreshSession(true);
      } catch (error) {
        if ((error as ApiError).status === 401) {
          this.invalidateSession();
          const sessionError = new Error("会话已过期，请重新登录") as Error & { status: number };
          sessionError.status = 401;
          throw sessionError;
        }
        throw error;
      }

      const retryResponse = await fetch(url, {
        ...options,
        headers,
        credentials: "include",
      });
      if (!retryResponse.ok) {
        throw await this.parseError(retryResponse);
      }
      if (retryResponse.status === 204) {
        return undefined as T;
      }
      return retryResponse.json();
    }

    if (!response.ok) {
      throw await this.parseError(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  private async parseError(response: Response): Promise<ApiError> {
    try {
      const data = await response.json();
      return {
        code: data.code,
        error: data.error || data.code || "Unknown error",
        message: data.message || data.error || response.statusText,
        status: response.status,
        ...(typeof data.line === "number" ? { line: data.line, column: data.column } : {}),
      };
    } catch {
      return {
        error: "Request failed",
        message: response.statusText,
        status: response.status,
      };
    }
  }

  /** 刷新浏览器会话；所有标签页共用同一请求，避免重复消费轮换型 refresh token。 */
  async refreshSession(force = false): Promise<void> {
    // 防止并发刷新
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const refreshStartedAt = Date.now();
    const refresh = async () => {
      if (typeof window !== "undefined") {
        const refreshedAt = Number(localStorage.getItem(SESSION_REFRESHED_AT_KEY));
        if (Number.isFinite(refreshedAt) && refreshedAt >= refreshStartedAt) {
          this.hasSessionHint = true;
          this.getSessionExpiresAt();
          return;
        }
        const expiresAt = this.getSessionExpiresAt();
        if (!force && expiresAt && expiresAt * 1000 - Date.now() > 5 * 60 * 1000) {
          return;
        }
      }
      await this.authRefresh({});
    };

    const refreshRequest = (async () => {
      if (typeof navigator !== "undefined" && navigator.locks) {
        await navigator.locks.request(SESSION_REFRESH_LOCK, async () => {
          await refresh();
        });
      } else {
        await refresh();
      }
    })();
    this.refreshPromise = refreshRequest.finally(() => {
      this.refreshPromise = null;
    });

    return refreshRequest;
  }

  // ==================== 认证 API ====================

  async login(req: LoginRequest): Promise<AuthToken> {
    const tokens = await this.request<AuthToken>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify(req),
      },
      false
    );
    this.setSession(tokens);
    return tokens;
  }

  async devtokenLogin(req: DevTokenLoginRequest): Promise<AuthToken> {
    const tokens = await this.request<AuthToken>(
      "/auth/devtoken",
      {
        method: "POST",
        body: JSON.stringify(req),
      },
      false
    );
    this.setSession(tokens);
    return tokens;
  }

  async authRefresh(req: RefreshRequest = {}): Promise<AuthToken> {
    // 刷新 token 时不使用 Authorization header；浏览器依赖 HttpOnly cookie
    const body: Record<string, string> = {};
    if (req.refresh_token) {
      body.refresh_token = req.refresh_token;
    }
    const response = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hypercraft-CSRF": "1",
      },
      body: JSON.stringify(body),
      credentials: "include",
    });
    if (!response.ok) {
      throw await this.parseError(response);
    }
    const tokens: AuthToken = await response.json();
    this.setSession(tokens);
    return tokens;
  }

  async logout(): Promise<void> {
    try {
      await fetch(`${getApiBaseUrl()}/auth/logout`, {
        method: "POST",
        headers: { "X-Hypercraft-CSRF": "1" },
        credentials: "include",
      });
    } catch {
      // 忽略网络错误，本地仍清除会话提示
    }
    this.clearSession();
  }

  async getMe(): Promise<UserSummary> {
    return this.request<UserSummary>("/auth/me");
  }

  // ==================== 2FA API ====================

  async setup2FA(req: Setup2FARequest): Promise<Setup2FAResponse> {
    return this.request<Setup2FAResponse>("/auth/2fa/setup", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async enable2FA(req: Enable2FARequest): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>("/auth/2fa/enable", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async disable2FA(req: Disable2FARequest): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>("/auth/2fa/disable", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  // ==================== 用户 API ====================

  async listUsers(): Promise<UserSummary[]> {
    return this.request<UserSummary[]>("/users");
  }

  async getUser(id: string): Promise<UserSummary> {
    return this.request<UserSummary>(`/users/${id}`);
  }

  async createUser(req: CreateUserRequest): Promise<UserSummary> {
    return this.request<UserSummary>("/users", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async updateUser(id: string, req: UpdateUserRequest): Promise<UserSummary> {
    return this.request<UserSummary>(`/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(req),
    });
  }

  async deleteUser(id: string): Promise<void> {
    return this.request<void>(`/users/${id}`, {
      method: "DELETE",
    });
  }

  async setUserServices(id: string, serviceIds: string[]): Promise<UserSummary> {
    return this.request<UserSummary>(`/users/${id}/services`, {
      method: "PUT",
      body: JSON.stringify({ service_ids: serviceIds }),
    });
  }

  async addUserService(userId: string, serviceId: string): Promise<UserSummary> {
    return this.request<UserSummary>(`/users/${userId}/services/${serviceId}`, {
      method: "POST",
    });
  }

  async removeUserService(userId: string, serviceId: string): Promise<UserSummary> {
    return this.request<UserSummary>(`/users/${userId}/services/${serviceId}`, {
      method: "DELETE",
    });
  }

  async changePassword(id: string, req: ChangePasswordRequest): Promise<UserSummary> {
    return this.request<UserSummary>(`/users/${id}/password`, {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  // ==================== API Key ====================

  async listApiKeys(): Promise<ApiKeySummary[]> {
    return this.request<ApiKeySummary[]>("/api-keys");
  }

  async getApiKey(id: string): Promise<ApiKeySummary> {
    return this.request<ApiKeySummary>(`/api-keys/${id}`);
  }

  async revealApiKeySecret(id: string): Promise<ApiKeySecretResponse> {
    return this.request<ApiKeySecretResponse>(`/api-keys/${id}/secret`);
  }

  async createApiKey(req: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
    return this.request<CreateApiKeyResponse>("/api-keys", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async updateApiKey(id: string, req: UpdateApiKeyRequest): Promise<ApiKeySummary> {
    return this.request<ApiKeySummary>(`/api-keys/${id}`, {
      method: "PUT",
      body: JSON.stringify(req),
    });
  }

  async rotateApiKey(id: string): Promise<CreateApiKeyResponse> {
    return this.request<CreateApiKeyResponse>(`/api-keys/${id}/rotate`, {
      method: "POST",
    });
  }

  async revokeApiKey(id: string): Promise<ApiKeySummary> {
    return this.request<ApiKeySummary>(`/api-keys/${id}`, {
      method: "DELETE",
    });
  }

  // ==================== 运行环境 ====================

  async listRuntimes(tool?: string): Promise<Runtime[]> {
    return this.request<Runtime[]>(`/runtimes${tool ? `?tool=${encodeURIComponent(tool)}` : ""}`);
  }

  async listRuntimeTools(): Promise<ToolListResponse> {
    return this.request<ToolListResponse>("/runtimes/tools");
  }

  async getToolVersions(tool: string, refresh = false): Promise<ToolVersions> {
    return this.request<ToolVersions>(
      `/runtimes/tools/${encodeURIComponent(tool)}/versions${refresh ? "?refresh=true" : ""}`
    );
  }

  async getJavaCatalog(refresh = false): Promise<JavaCatalog> {
    return this.request<JavaCatalog>(`/runtimes/java/catalog${refresh ? "?refresh=true" : ""}`);
  }

  async installRuntime(req: { tool?: string; spec: string; id?: string; name?: string }): Promise<InstallTask> {
    return this.request<InstallTask>("/runtimes/install", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async listInstallTasks(): Promise<InstallTask[]> {
    return this.request<InstallTask[]>("/runtimes/tasks");
  }

  async cancelInstallTask(id: string): Promise<void> {
    await this.request<void>(`/runtimes/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  }

  async deleteInstallTask(id: string): Promise<void> {
    await this.request<void>(`/runtimes/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async clearInstallTasks(): Promise<{ removed: number }> {
    return this.request<{ removed: number }>("/runtimes/tasks", { method: "DELETE" });
  }

  async getRuntimeStorage(): Promise<RuntimeStorage> {
    return this.request<RuntimeStorage>("/runtimes/storage");
  }

  async cleanupRuntimes(req: { tasks?: boolean; cache?: boolean; orphans?: boolean }): Promise<CleanupResult> {
    return this.request<CleanupResult>("/runtimes/cleanup", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async registerJavaRuntime(req: { id: string; name?: string; home: string }): Promise<Runtime> {
    return this.request<Runtime>("/runtimes", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async renameRuntime(id: string, name: string): Promise<Runtime> {
    return this.request<Runtime>(`/runtimes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  }

  async deleteRuntime(id: string): Promise<void> {
    await this.request<void>(`/runtimes/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async getRuntimeSettings(): Promise<RuntimeDownloadSettings> {
    return this.request<RuntimeDownloadSettings>("/runtimes/settings");
  }

  async updateRuntimeSettings(req: RuntimeDownloadSettings): Promise<RuntimeDownloadSettings> {
    return this.request<RuntimeDownloadSettings>("/runtimes/settings", {
      method: "PUT",
      body: JSON.stringify(req),
    });
  }

  // ==================== 服务 API ====================

  /** 默认服务页列表（按当前用户 service_ids 过滤） */
  async listServices(): Promise<ServiceSummary[]> {
    return this.request<ServiceSummary[]>("/services");
  }

  /** 用户授权用全量服务候选（仅管理员） */
  async listServicesForAssign(): Promise<ServiceSummary[]> {
    return this.request<ServiceSummary[]>("/users/service-catalog");
  }

  async getService(id: string): Promise<ServiceDetail> {
    return this.request<ServiceDetail>(`/services/${id}`);
  }

  // ==================== 服务文件（工作目录内） ====================

  async listServiceFiles(id: string, path = ""): Promise<DirListing> {
    return this.request<DirListing>(`/services/${id}/files?path=${encodeURIComponent(path)}`);
  }

  /** 读取文件内容；view="hex" 时以十六进制只读视图打开（用于二进制文件） */
  async readServiceFile(id: string, path: string, view?: "hex"): Promise<FileContent> {
    const q = `path=${encodeURIComponent(path)}${view ? `&view=${view}` : ""}`;
    return this.request<FileContent>(`/services/${id}/files/content?${q}`);
  }

  /** etag 为空表示强制覆盖；encoding 为读取时检测到的编码，按原编码写回 */
  async writeServiceFile(
    id: string,
    path: string,
    content: string,
    etag?: string | null,
    encoding?: TextEncoding,
  ): Promise<WriteFileResponse> {
    return this.request<WriteFileResponse>(`/services/${id}/files/content`, {
      method: "PUT",
      body: JSON.stringify({ path, content, etag: etag ?? null, ...(encoding ? { encoding } : {}) }),
    });
  }

  async createServiceFile(id: string, path: string, kind: "file" | "dir"): Promise<FileEntry> {
    return this.request<FileEntry>(`/services/${id}/files/create`, {
      method: "POST",
      body: JSON.stringify({ path, kind }),
    });
  }

  /** 重命名或移动 */
  async renameServiceFile(id: string, from: string, to: string): Promise<void> {
    return this.request<void>(`/services/${id}/files/rename`, {
      method: "POST",
      body: JSON.stringify({ from, to }),
    });
  }

  /**
   * 整文件上传（请求体为原始字节，≤ 512 MiB）。面板默认使用分片上传（可断点续传），
   * 此方法保留给脚本 / 小文件场景。用 XHR 以获得上传进度；
   * 401 时续期会话后重试一次。
   */
  async uploadServiceFile(
    id: string,
    dir: string,
    file: File,
    options: { overwrite?: boolean; onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal } = {},
  ): Promise<FileEntry> {
    const params = new URLSearchParams({ dir, name: file.name, overwrite: String(!!options.overwrite) });
    const url = `${getApiBaseUrl()}/services/${id}/files/upload?${params}`;
    const send = () =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url);
        xhr.withCredentials = true;
        xhr.setRequestHeader("X-Hypercraft-CSRF", "1");
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.onprogress = (e) => options.onProgress?.(e.loaded, e.lengthComputable ? e.total : file.size);
        xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
        xhr.onerror = () => reject({ error: "NetworkError", message: "网络错误，上传失败", status: 0 } satisfies ApiError);
        xhr.onabort = () => reject({ error: "Aborted", message: "已取消上传", status: 0 } satisfies ApiError);
        options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
        xhr.send(file);
      });

    let res = await send();
    if (res.status === 401) {
      await this.refreshSession(true);
      res = await send();
    }
    if (res.status < 200 || res.status >= 300) {
      let data: { code?: string; message?: string; error?: string } = {};
      try {
        data = JSON.parse(res.body);
      } catch {
        // 代理返回的非 JSON 错误（如 nginx 413）
      }
      throw {
        code: data.code,
        error: data.error || data.code || "UploadFailed",
        message: data.message || (res.status === 413 ? "文件过大" : `上传失败（HTTP ${res.status}）`),
        status: res.status,
      } satisfies ApiError;
    }
    return JSON.parse(res.body) as FileEntry;
  }

  // ==================== 分片上传 / 断点续传 ====================

  /** 创建上传会话；fingerprint 相同则找回未完成的会话 */
  async initChunkedUpload(id: string, req: InitUploadRequest): Promise<InitUploadResponse> {
    return this.request<InitUploadResponse>(`/services/${id}/files/uploads`, {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async getChunkedUpload(id: string, uploadId: string): Promise<UploadStatus> {
    return this.request<UploadStatus>(`/services/${id}/files/uploads/${uploadId}`);
  }

  /** 上传单个分片（原始字节 + SHA-256），可重复调用（幂等） */
  async uploadChunk(
    id: string,
    uploadId: string,
    index: number,
    data: Blob,
    sha256: string,
    options: { signal?: AbortSignal; onProgress?: (loaded: number) => void } = {},
  ): Promise<UploadStatus> {
    const url = `${getApiBaseUrl()}/services/${id}/files/uploads/${uploadId}/chunks/${index}`;
    const send = () =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url);
        xhr.withCredentials = true;
        xhr.setRequestHeader("X-Hypercraft-CSRF", "1");
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.setRequestHeader("X-Chunk-Sha256", sha256);
        xhr.upload.onprogress = (e) => options.onProgress?.(e.loaded);
        xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
        xhr.onerror = () => reject({ error: "NetworkError", message: "网络错误", status: 0 } satisfies ApiError);
        xhr.onabort = () => reject({ error: "Aborted", message: "已暂停", status: 0 } satisfies ApiError);
        if (options.signal?.aborted) {
          reject({ error: "Aborted", message: "已暂停", status: 0 } satisfies ApiError);
          return;
        }
        options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
        xhr.send(data);
      });
    let res = await send();
    if (res.status === 401) {
      await this.refreshSession(true);
      res = await send();
    }
    if (res.status < 200 || res.status >= 300) {
      let data: { code?: string; message?: string; error?: string } = {};
      try {
        data = JSON.parse(res.body);
      } catch {
        // 代理返回的非 JSON 错误
      }
      throw {
        code: data.code,
        error: data.error || data.code || "ChunkFailed",
        message: data.message || `分片上传失败（HTTP ${res.status}）`,
        status: res.status,
      } satisfies ApiError;
    }
    return JSON.parse(res.body) as UploadStatus;
  }

  async completeChunkedUpload(id: string, uploadId: string, overwrite?: boolean): Promise<FileEntry> {
    return this.request<FileEntry>(`/services/${id}/files/uploads/${uploadId}/complete`, {
      method: "POST",
      body: JSON.stringify(overwrite === undefined ? {} : { overwrite }),
    });
  }

  async abortChunkedUpload(id: string, uploadId: string): Promise<void> {
    return this.request<void>(`/services/${id}/files/uploads/${uploadId}`, { method: "DELETE" });
  }

  /**
   * 下载服务工作目录中的文件（≤ 512 MiB）。
   * 交给浏览器原生下载（流式写盘、自带进度），不把整个文件读进页面内存；
   * 先用 HEAD 预检权限与会话，避免 401/403 时浏览器打开错误页面。
   */
  async downloadServiceFile(id: string, path: string): Promise<void> {
    const url = `${getApiBaseUrl()}/services/${id}/files/download?path=${encodeURIComponent(path)}`;
    let response = await fetch(url, { method: "HEAD", credentials: "include" });
    if (response.status === 401) {
      await this.refreshSession(true);
      response = await fetch(url, { method: "HEAD", credentials: "include" });
    }
    if (!response.ok) {
      // HEAD 无响应体，按状态码给出提示
      const messages: Record<number, string> = {
        401: "会话已过期，请重新登录",
        403: "没有权限下载该文件",
        404: "文件不存在",
        413: "文件超过 512 MB，无法下载",
      };
      throw {
        error: "DownloadFailed",
        message: messages[response.status] || `下载失败（HTTP ${response.status}）`,
        status: response.status,
      } satisfies ApiError;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = path.split("/").pop() || "download";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /** 读取服务文件为 Blob（Markdown 预览中嵌入的相对路径图片等小文件） */
  async fetchServiceFileBlob(id: string, path: string): Promise<Blob> {
    const url = `${getApiBaseUrl()}/services/${id}/files/download?path=${encodeURIComponent(path)}`;
    let response = await fetch(url, { credentials: "include" });
    if (response.status === 401) {
      await this.refreshSession(true);
      response = await fetch(url, { credentials: "include" });
    }
    if (!response.ok) {
      throw { error: "DownloadFailed", message: `读取失败（HTTP ${response.status}）`, status: response.status } satisfies ApiError;
    }
    return response.blob();
  }

  async deleteServiceFile(id: string, path: string): Promise<void> {
    return this.request<void>(`/services/${id}/files?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    });
  }

  async createService(manifest: ServiceManifest): Promise<ServiceManifest> {
    return this.request<ServiceManifest>("/services", {
      method: "POST",
      body: JSON.stringify(manifest),
    });
  }

  async updateService(id: string, manifest: ServiceManifest): Promise<void> {
    return this.request<void>(`/services/${id}`, {
      method: "PUT",
      body: JSON.stringify(manifest),
    });
  }

  async deleteService(id: string): Promise<void> {
    return this.request<void>(`/services/${id}`, {
      method: "DELETE",
    });
  }

  async startService(id: string): Promise<ServiceStatus> {
    return this.request<ServiceStatus>(`/services/${id}/start`, {
      method: "POST",
    });
  }

  async stopService(id: string): Promise<ServiceStatus> {
    return this.request<ServiceStatus>(`/services/${id}/stop`, {
      method: "POST",
    });
  }

  async shutdownService(id: string): Promise<ServiceStatus> {
    return this.request<ServiceStatus>(`/services/${id}/shutdown`, {
      method: "POST",
    });
  }

  async killService(id: string): Promise<ServiceStatus> {
    return this.request<ServiceStatus>(`/services/${id}/kill`, {
      method: "POST",
    });
  }

  async restartService(id: string): Promise<ServiceStatus> {
    return this.request<ServiceStatus>(`/services/${id}/restart`, {
      method: "POST",
    });
  }

  async getServiceStatus(id: string): Promise<ServiceStatus> {
    return this.request<ServiceStatus>(`/services/${id}/status`);
  }

  async createWebSession(id: string): Promise<WebSessionResponse> {
    return this.request<WebSessionResponse>(`/services/${id}/web/session`, {
      method: "POST",
    });
  }

  // ==================== 定时调度 API ====================

  async getServiceSchedule(id: string): Promise<ScheduleResponse> {
    return this.request<ScheduleResponse>(`/services/${id}/schedule`);
  }

  async updateServiceSchedule(id: string, req: UpdateScheduleRequest): Promise<ScheduleResponse> {
    return this.request<ScheduleResponse>(`/services/${id}/schedule`, {
      method: "PUT",
      body: JSON.stringify(req),
    });
  }

  async validateCron(req: ValidateCronRequest): Promise<ValidateCronResponse> {
    return this.request<ValidateCronResponse>("/schedule/validate", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  // ==================== 服务 Tags 和分组 ====================

  async updateServiceTags(id: string, tags: string[]): Promise<void> {
    return this.request<void>(`/services/${id}/tags`, {
      method: "PATCH",
      body: JSON.stringify({ tags }),
    });
  }

  async updateServiceGroup(id: string, group: string | null): Promise<void> {
    return this.request<void>(`/services/${id}/group`, {
      method: "PATCH",
      body: JSON.stringify({ group }),
    });
  }

  async reorderServices(request: ReorderServicesRequest): Promise<void> {
    return this.request<void>("/services/reorder", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  // ==================== 分组管理 ====================

  async listGroups(): Promise<ServiceGroup[]> {
    return this.request<ServiceGroup[]>("/groups");
  }

  async createGroup(request: CreateGroupRequest): Promise<ServiceGroup> {
    return this.request<ServiceGroup>("/groups", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async updateGroup(id: string, request: UpdateGroupRequest): Promise<ServiceGroup> {
    return this.request<ServiceGroup>(`/groups/${id}`, {
      method: "PATCH",
      body: JSON.stringify(request),
    });
  }

  async deleteGroup(id: string): Promise<void> {
    return this.request<void>(`/groups/${id}`, {
      method: "DELETE",
    });
  }

  async reorderGroups(groupIds: string[]): Promise<ServiceGroup[]> {
    return this.request<ServiceGroup[]>("/groups/reorder", {
      method: "POST",
      body: JSON.stringify({ group_ids: groupIds }),
    });
  }

  // ==================== 日志 ====================

  // 获取原始日志数据（base64 编码）
  async getServiceLogsRaw(id: string, bytes: number = 64 * 1024): Promise<{ id: string; data: string }> {
    return this.request<{ id: string; data: string }>(`/services/${id}/logs?tail=${bytes}`);
  }

  // 下载服务配置的日志文件
  async downloadServiceLogFile(id: string): Promise<void> {
    const url = `${getApiBaseUrl()}/services/${id}/log-file`;
    let response = await fetch(url, {
      credentials: "include",
    });

    if (response.status === 401) {
      await this.refreshSession(true);
      response = await fetch(url, {
        credentials: "include",
      });
    }

    if (!response.ok) {
      const error = await this.parseError(response);
      throw error;
    }

    // 从 Content-Disposition 中提取文件名
    const contentDisposition = response.headers.get("Content-Disposition");
    let filename = "service.log";
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match) {
        filename = match[1];
      }
    }

    // 触发下载
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);
  }

  // ==================== 健康检查 ====================

  async health(): Promise<{ status: string }> {
    return this.request<{ status: string }>("/health", {}, false);
  }

  // ==================== 资源统计 ====================

  async getSystemStats(): Promise<SystemStats> {
    return this.request<SystemStats>("/stats/system");
  }
}

// 单例导出
export const api = new ApiClient();
