// API 类型定义 - 与后端 Rust 模型对应

// ==================== 系统资源统计 ====================

export interface SystemStats {
  cpu_usage: number;
  memory_total: number;
  memory_used: number;
  memory_usage: number;
  disk_total: number;
  disk_used: number;
  disk_usage: number;
}

// ==================== 服务相关 ====================

export type ServiceState = "running" | "stopped" | "unknown";

export interface ServiceSummary {
  id: string;
  name: string;
  state: ServiceState;
  tags: string[];
  group: string | null;
  order: number;
}

export interface ServiceStatus {
  state: ServiceState;
  pid?: number;
  uptime_ms?: number;
}

// ==================== 定时调度相关 ====================

export type ScheduleAction = "start" | "restart" | "stop";

export interface Schedule {
  enabled: boolean;
  cron: string;
  action: ScheduleAction;
  timezone?: string;
}

export interface ScheduleResponse {
  schedule: Schedule | null;
  next_run: string | null;
}

export interface UpdateScheduleRequest {
  schedule: Schedule | null;
}

export interface ValidateCronRequest {
  cron: string;
}

export interface ValidateCronResponse {
  valid: boolean;
  next_runs: string[];
  error?: string;
}

export interface WebConfig {
  enabled: boolean;
  upstream: string;
  title?: string;
  health_path?: string;
}

export interface ServiceManifest {
  id: string;
  name: string;
  command: string;
  /** 选用的运行环境 ID 列表（可多选，如 Java 21 + Node 22），前置到 PATH 并注入 JAVA_HOME 等 */
  runtimes?: string[];
  /** @deprecated 旧字段，读取时已并入 runtimes */
  java_runtime?: string | null;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  auto_start?: boolean;
  auto_restart?: boolean;
  clear_log_on_start?: boolean;
  shutdown_command?: string;
  run_as?: string;
  created_at?: string;
  tags?: string[];
  group?: string | null;
  order?: number;
  log_path?: string;
  pty_rows?: number;
  terminal_tui?: boolean;
  schedule?: Schedule;
  web?: WebConfig;
}

export interface ServiceDetail {
  manifest: ServiceManifest;
  status: ServiceStatus;
}

// ==================== 分组相关 ====================

export interface ServiceGroup {
  id: string;
  name: string;
  order: number;
  color?: string | null;
}

export interface CreateGroupRequest {
  id: string;
  name: string;
  color?: string;
}

export interface UpdateGroupRequest {
  name?: string;
  color?: string | null;
}

export interface ReorderServicesRequest {
  services: Array<{
    id: string;
    group: string | null;
    order: number;
  }>;
}

// ==================== 用户相关 ====================

export interface UserSummary {
  id: string;
  username: string;
  service_ids: string[];
  is_admin: boolean;
  totp_enabled: boolean;
  created_at?: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  service_ids?: string[];
}

export interface UpdateUserRequest {
  password?: string;
  service_ids?: string[];
  is_admin?: boolean;
}

export interface ChangePasswordRequest {
  new_password: string;
  current_password?: string;
}

// ==================== API Key（Agent）====================

export type ApiKeyScope = "read" | "control" | "manage" | "logs" | "attach";

export interface ApiKeySummary {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_by: string;
  created_at: string;
  last_used_at?: string | null;
  revoked_at?: string | null;
  expires_at?: string | null;
}

export interface CreateApiKeyRequest {
  name: string;
  scopes: string[];
  expires_at?: string | null;
}

export interface UpdateApiKeyRequest {
  name?: string;
  scopes?: string[];
  expires_at?: string | null;
}

export interface CreateApiKeyResponse {
  key: ApiKeySummary;
  secret: string;
}

export interface ApiKeySecretResponse {
  id: string;
  name: string;
  secret: string;
}

// ==================== 认证相关 ====================

export type TokenType = "dev" | "user" | "web" | "refresh" | "apikey";

export interface TokenClaims {
  sub: string;
  username: string;
  token_type: TokenType;
  service_ids?: string[];
  service_id?: string;
  is_admin?: boolean;
  exp: number;
  iat: number;
}

export interface AuthToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface LoginRequest {
  username: string;
  password: string;
  totp_code?: string;
}

export interface DevTokenLoginRequest {
  dev_token: string;
  totp_code?: string;
}

export interface RefreshRequest {
  /** 可选：浏览器依赖 HttpOnly cookie；CLI 仍应显式传值 */
  refresh_token?: string;
}

// ==================== 2FA 相关 ====================

export interface Setup2FAResponse {
  secret: string;
  qr_uri: string;
  recovery_codes: string[];
}

export interface Setup2FARequest {}

export interface Enable2FARequest {
  totp_code: string;
  secret: string;
  recovery_codes: string[];
}

export interface Disable2FARequest {
  verification: TwoFactorVerification;
}

export type TwoFactorVerification =
  | { type: "totp"; code: string }
  | { type: "recovery"; code: string };

// ==================== 日志相关 ====================

export interface LogsResponse {
  id: string;
  lines: string[];
}

export interface WebSessionResponse {
  url: string;
}

// ==================== 运行环境 ====================

export type JavaRuntimeSource = "managed" | "custom" | "system";

export interface Runtime {
  id: string;
  /** mise 工具名：java / node / python / go … */
  tool: string;
  name: string;
  major: number;
  version: string;
  vendor: string;
  image_type: string;
  arch: string;
  home: string;
  source: JavaRuntimeSource;
  installed_at?: string | null;
  size_bytes?: number | null;
  mise_version?: string | null;
  spec?: string | null;
  bin_paths: string[];
  env: Record<string, string>;
  used_by: string[];
}

/** @deprecated 使用 Runtime */
export type JavaRuntime = Runtime;

export interface JavaCatalogItem {
  spec: string;
  vendor_key: string;
  vendor: string;
  image_type: string;
  major: number;
  latest: string;
  common: boolean;
  installed_id?: string | null;
  installed_version?: string | null;
}

export type AdoptiumMirror = "official" | "tuna" | "ustc";

export interface RuntimeDownloadSettings {
  adoptium_mirror: AdoptiumMirror;
  github_proxy: string;
  /** Node.js / Python / Go 使用国内镜像 */
  cn_mirrors: boolean;
}

/** @deprecated 使用 RuntimeDownloadSettings */
export type JavaDownloadSettings = RuntimeDownloadSettings;

export interface JavaCatalog {
  arch: string;
  mise_version: string;
  settings: RuntimeDownloadSettings;
  items: JavaCatalogItem[];
}

export interface RegistryTool {
  name: string;
  description?: string | null;
  backends: string[];
  bins: string[];
  aliases: string[];
}

export interface ToolListResponse {
  featured: RegistryTool[];
  tools: RegistryTool[];
}

export interface ToolVersions {
  tool: string;
  channels: string[];
  versions: string[];
}

export type InstallState =
  | "pending"
  | "resolving"
  | "downloading"
  | "extracting"
  | "done"
  | "failed"
  | "cancelled";

export interface InstallTask {
  id: string;
  tool: string;
  runtime_id: string;
  spec: string;
  state: InstallState;
  source_url?: string | null;
  message?: string | null;
  log: string[];
  started_at: string;
  finished_at?: string | null;
}

/** @deprecated 使用 InstallTask */
export type JavaInstallTask = InstallTask;

export interface OrphanInstall {
  tool: string;
  version: string;
  path: string;
  size_bytes: number;
}

export interface RuntimeStorage {
  installs_bytes: number;
  cache_bytes: number;
  orphans: OrphanInstall[];
}

export interface CleanupResult {
  removed_tasks: number;
  freed_cache_bytes: number;
  removed_orphans: string[];
  freed_orphan_bytes: number;
}

// ==================== API 响应 ====================

export interface ApiError {
  code?: string;
  error: string;
  message: string;
  status?: number;
}
