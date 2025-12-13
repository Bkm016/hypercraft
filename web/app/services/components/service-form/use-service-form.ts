import { useState, useEffect, useCallback } from "react";
import { api, type ServiceManifest, type Schedule, type ScheduleAction } from "@/lib/api";
import type { ServiceFormData, EnvVar, FormMode } from "./types";

export interface UseServiceFormOptions {
  mode: FormMode;
  manifest?: ServiceManifest;
  onReset?: () => void;
}

export function useServiceForm({ mode, manifest, onReset }: UseServiceFormOptions) {
  const isEditMode = mode === "edit";
  const isDuplicateMode = mode === "duplicate";

  // 表单数据
  const [data, setData] = useState<ServiceFormData>({
    id: "",
    name: "",
    command: "",
    args: [],
    cwd: "",
    autoStart: false,
    autoRestart: true,
    clearLogOnStart: true,
    shutdownCommand: "",
    runAs: "",
    logPath: "",
    envVars: [],
    scheduleAction: "none",
    scheduleCron: "",
  });

  // 验证状态
  const [cronError, setCronError] = useState<string | null>(null);
  const [cronValidating, setCronValidating] = useState(false);

  // 更新单个字段
  const setField = useCallback(<K extends keyof ServiceFormData>(
    field: K,
    value: ServiceFormData[K]
  ) => {
    setData((prev) => ({ ...prev, [field]: value }));
  }, []);

  // 环境变量操作
  const addEnvVar = useCallback(() => {
    setData((prev) => ({
      ...prev,
      envVars: [...prev.envVars, { key: "", value: "" }],
    }));
  }, []);

  const removeEnvVar = useCallback((index: number) => {
    setData((prev) => ({
      ...prev,
      envVars: prev.envVars.filter((_, i) => i !== index),
    }));
  }, []);

  const updateEnvVar = useCallback((index: number, field: "key" | "value", value: string) => {
    setData((prev) => {
      const updated = [...prev.envVars];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, envVars: updated };
    });
  }, []);

  // 实时验证 Cron 表达式
  const validateCron = useCallback(async (cron: string) => {
    if (!cron.trim()) {
      setCronError(null);
      return true;
    }
    setCronValidating(true);
    try {
      const result = await api.validateCron({ cron: cron.trim() });
      const error = result.valid ? null : (result.error || "格式错误");
      setCronError(error);
      return result.valid;
    } catch {
      setCronError("验证失败");
      return false;
    } finally {
      setCronValidating(false);
    }
  }, []);

  // 防抖验证 cron
  useEffect(() => {
    if (data.scheduleAction === "none" || !data.scheduleCron.trim()) {
      setCronError(null);
      return;
    }
    const timer = setTimeout(() => validateCron(data.scheduleCron), 400);
    return () => clearTimeout(timer);
  }, [data.scheduleCron, data.scheduleAction, validateCron]);

  // 初始化表单数据
  const initForm = useCallback((m?: ServiceManifest) => {
    if (m) {
      setData({
        id: isDuplicateMode ? "" : m.id,
        name: isDuplicateMode ? `${m.name} (副本)` : m.name,
        command: m.command,
        args: m.args || [],
        cwd: m.cwd || "",
        autoStart: m.auto_start ?? false,
        autoRestart: m.auto_restart ?? true,
        clearLogOnStart: m.clear_log_on_start ?? true,
        shutdownCommand: m.shutdown_command || "",
        runAs: m.run_as || "",
        logPath: m.log_path || "",
        envVars: m.env
          ? Object.entries(m.env).map(([key, value]) => ({ key, value }))
          : [],
        scheduleAction: m.schedule?.enabled ? m.schedule.action : "none",
        scheduleCron: m.schedule?.cron || "",
      });
    } else {
      setData({
        id: "",
        name: "",
        command: "",
        args: [],
        cwd: "",
        autoStart: false,
        autoRestart: true,
        clearLogOnStart: true,
        shutdownCommand: "",
        runAs: "",
        logPath: "",
        envVars: [],
        scheduleAction: "none",
        scheduleCron: "",
      });
    }
    setCronError(null);
  }, [isDuplicateMode]);

  // 构建提交数据
  const buildManifest = useCallback((originalManifest?: ServiceManifest): ServiceManifest => {
    const envObj: Record<string, string> = {};
    for (const { key, value } of data.envVars) {
      if (key.trim()) {
        envObj[key.trim()] = value;
      }
    }

    const scheduleConfig: Schedule | undefined =
      data.scheduleAction !== "none"
        ? {
            enabled: true,
            cron: data.scheduleCron.trim(),
            action: data.scheduleAction,
          }
        : undefined;

    return {
      id: isEditMode ? originalManifest!.id : data.id.trim(),
      name: data.name.trim(),
      command: data.command.trim(),
      args: data.args.length > 0 ? data.args.map((l) => l.trim()).filter(Boolean) : undefined,
      cwd: data.cwd.trim() || undefined,
      env: Object.keys(envObj).length > 0 ? envObj : undefined,
      auto_restart: data.autoRestart,
      auto_start: data.autoStart,
      clear_log_on_start: data.clearLogOnStart,
      shutdown_command: data.shutdownCommand.trim() || undefined,
      run_as: data.runAs.trim() || undefined,
      log_path: data.logPath.trim() || undefined,
      schedule: scheduleConfig,
      ...(isEditMode && originalManifest && {
        tags: originalManifest.tags,
        group: originalManifest.group,
        order: originalManifest.order,
      }),
    };
  }, [data, isEditMode]);

  // 验证表单
  const validate = useCallback(async (): Promise<string | null> => {
    if (!isEditMode && !data.id.trim()) {
      return "服务 ID 不能为空";
    }
    if (!data.name.trim()) {
      return "服务名称不能为空";
    }
    if (!data.command.trim()) {
      return "启动命令不能为空";
    }
    if (!isEditMode && !/^[a-zA-Z0-9_.-]+$/.test(data.id)) {
      return "服务 ID 只能包含字母、数字、横线、下划线和点";
    }
    if (data.scheduleAction !== "none") {
      if (!data.scheduleCron.trim()) {
        return "启用定时任务时必须填写 Cron 表达式";
      }
      if (cronError) {
        return `Cron 表达式无效: ${cronError}`;
      }
      const valid = await validateCron(data.scheduleCron);
      if (!valid) {
        return `Cron 表达式无效`;
      }
    }
    return null;
  }, [data, isEditMode, cronError, validateCron]);

  return {
    data,
    setField,
    addEnvVar,
    removeEnvVar,
    updateEnvVar,
    cronError,
    cronValidating,
    initForm,
    buildManifest,
    validate,
    isEditMode,
    isDuplicateMode,
  };
}
