"use client";

import * as Button from "@/components/ui/button";
import type { ServiceManifest } from "@/lib/api";
import { PageCard } from "@/components/layout/page-layout";
import { RiEditLine } from "@remixicon/react";

export interface ConfigPanelProps {
  manifest: ServiceManifest;
  onEdit: () => void;
}

export function ConfigPanel({ 
  manifest, 
  onEdit,
}: ConfigPanelProps) {
  const config = [
    { key: "命令", value: manifest.command },
    { key: "参数", value: manifest.args?.join(" ") || "—" },
    { key: "工作目录", value: manifest.cwd || "—" },
    { key: "运行用户", value: manifest.run_as || "—" },
    {
      key: "环境变量",
      value: manifest.env
        ? Object.entries(manifest.env)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")
        : "—",
    },
    { key: "自动启动", value: manifest.auto_start ? "是" : "否" },
    { key: "自动重启", value: manifest.auto_restart ? "是" : "否" },
    { key: "启动时清空日志", value: (manifest.clear_log_on_start ?? true) ? "是" : "否" },
    { key: "关闭命令", value: manifest.shutdown_command || "—" },
    { key: "创建时间", value: manifest.created_at ? new Date(manifest.created_at).toLocaleString("zh-CN") : "—" },
    { key: "日志路径", value: manifest.log_path || "—" },
  ];

  return (
    <PageCard
      title="服务配置"
      actions={
        <Button.Root size="xsmall" variant="neutral" mode="stroke" onClick={onEdit}>
          <Button.Icon as={RiEditLine} />
          编辑
        </Button.Root>
      }
      noPadding
    >
      <div className="divide-y divide-stroke-soft-200">
        {config.map((item) => (
          <div key={item.key} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-0 sm:px-5 sm:py-4">
            <span className="text-xs sm:text-sm font-medium text-text-sub-600 sm:w-24 sm:shrink-0">{item.key}</span>
            <code className="whitespace-pre-wrap break-all font-mono text-sm text-text-strong-950">{item.value}</code>
          </div>
        ))}
      </div>
    </PageCard>
  );
}
