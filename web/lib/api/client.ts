import type {
  AuthToken,
  LoginRequest,
  RefreshRequest,
  UserSummary,
  CreateUserRequest,
  UpdateUserRequest,
  ChangePasswordRequest,
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
} from "./types";

function getApiBaseUrl(): string {
  // Runtime config takes precedence (from public/config.js)
  if (typeof window !== "undefined" && window.__RUNTIME_CONFIG__?.apiUrl) {
    return window.__RUNTIME_CONFIG__.apiUrl;
  }
  // Fallback to build-time env or default
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshPromise: Promise<AuthToken> | null = null;

  constructor() {
    // 从 localStorage 恢复 token（仅客户端）
    if (typeof window !== "undefined") {
      this.accessToken = localStorage.getItem("access_token");
      this.refreshToken = localStorage.getItem("refresh_token");
    }
  }

  getBaseUrl(): string {
    return getApiBaseUrl();
  }

  // ==================== Token 管理 ====================

  setTokens(tokens: AuthToken) {
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    if (typeof window !== "undefined") {
      localStorage.setItem("access_token", tokens.access_token);
      localStorage.setItem("refresh_token", tokens.refresh_token);
    }
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    if (typeof window !== "undefined") {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
    }
  }

  isAuthenticated(): boolean {
    return !!this.getAccessToken();
  }

  getAccessToken(): string | null {
    // 客户端时从 localStorage 懒加载（解决 SSR hydration 问题）
    if (typeof window !== "undefined" && !this.accessToken) {
      this.accessToken = localStorage.getItem("access_token");
    }
    return this.accessToken;
  }

  getRefreshToken(): string | null {
    // 客户端时从 localStorage 懒加载
    if (typeof window !== "undefined" && !this.refreshToken) {
      this.refreshToken = localStorage.getItem("refresh_token");
    }
    return this.refreshToken;
  }

  // 设置 DevToken（不是JWT，直接作为 access_token 使用）
  setDevToken(token: string) {
    this.accessToken = token;
    this.refreshToken = null;
    if (typeof window !== "undefined") {
      localStorage.setItem("access_token", token);
      localStorage.removeItem("refresh_token");
    }
  }

  // ==================== 请求方法 ====================

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${getApiBaseUrl()}${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // 401 且有 refresh token 时尝试刷新
    if (response.status === 401 && this.refreshToken) {
      try {
        await this.refreshAccessToken();
        // 重试请求
        headers.Authorization = `Bearer ${this.accessToken}`;
        const retryResponse = await fetch(url, { ...options, headers });
        if (!retryResponse.ok) {
          throw await this.parseError(retryResponse);
        }
        if (retryResponse.status === 204) {
          return undefined as T;
        }
        return retryResponse.json();
      } catch {
        this.clearTokens();
        throw new Error("Session expired, please login again");
      }
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
        error: data.error || "Unknown error",
        message: data.message || data.error || response.statusText,
        status: response.status,
      };
    } catch {
      return {
        error: "Request failed",
        message: response.statusText,
        status: response.status,
      };
    }
  }

  private async refreshAccessToken(): Promise<AuthToken> {
    // 防止并发刷新
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.authRefresh({ refresh_token: this.refreshToken! })
      .then((tokens) => {
        this.setTokens(tokens);
        return tokens;
      })
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  // ==================== 认证 API ====================

  async login(req: LoginRequest): Promise<AuthToken> {
    const tokens = await this.request<AuthToken>("/auth/login", {
      method: "POST",
      body: JSON.stringify(req),
    });
    this.setTokens(tokens);
    return tokens;
  }

  async authRefresh(req: RefreshRequest): Promise<AuthToken> {
    // 刷新 token 时不使用 Authorization header
    const response = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!response.ok) {
      throw await this.parseError(response);
    }
    return response.json();
  }

  logout() {
    this.clearTokens();
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

  // ==================== 服务 API ====================

  async listServices(): Promise<ServiceSummary[]> {
    return this.request<ServiceSummary[]>("/services");
  }

  async getService(id: string): Promise<ServiceDetail> {
    return this.request<ServiceDetail>(`/services/${id}`);
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
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

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
    return this.request<{ status: string }>("/health");
  }

  // ==================== 资源统计 ====================

  async getSystemStats(): Promise<SystemStats> {
    return this.request<SystemStats>("/stats/system");
  }
}

// 单例导出
export const api = new ApiClient();
