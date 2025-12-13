import type { ScheduleAction } from "@/lib/api";

// 环境变量项
export interface EnvVar {
  key: string;
  value: string;
}

// 表单数据
export interface ServiceFormData {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd: string;
  autoStart: boolean;
  autoRestart: boolean;
  clearLogOnStart: boolean;
  shutdownCommand: string;
  runAs: string;
  logPath: string;
  envVars: EnvVar[];
  scheduleAction: "none" | ScheduleAction;
  scheduleCron: string;
}

// 表单模式
export type FormMode = "create" | "edit" | "duplicate";
