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

export interface ServiceManifest {
  id: string;
  name: string;
  command: string;
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
  schedule?: Schedule;
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
}

export interface ChangePasswordRequest {
  new_password: string;
  current_password?: string;
}

// ==================== 认证相关 ====================

export type TokenType = "dev" | "user" | "refresh";

export interface TokenClaims {
  sub: string;
  username: string;
  token_type: TokenType;
  service_ids?: string[];
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
}

export interface RefreshRequest {
  refresh_token: string;
}

// ==================== 日志相关 ====================

export interface LogsResponse {
  id: string;
  lines: string[];
}

// ==================== API 响应 ====================

export interface ApiError {
  error: string;
  message: string;
  status?: number;
}
