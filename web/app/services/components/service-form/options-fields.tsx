"use client";

import * as FormDialog from "@/components/ui/form-dialog";
import type { ServiceFormData } from "./types";

interface OptionsFieldsProps {
  data: ServiceFormData;
  setField: <K extends keyof ServiceFormData>(field: K, value: ServiceFormData[K]) => void;
}

export function OptionsFields({ data, setField }: OptionsFieldsProps) {
  return (
    <div className="space-y-4">
      <h4 className="text-xs font-medium uppercase tracking-wider text-text-soft-400">
        运行选项
      </h4>

      <FormDialog.Switch
        checked={data.autoStart}
        onCheckedChange={(v) => setField("autoStart", v)}
        label="自动启动"
        description="当后端运行时自动启动该服务"
      />

      <FormDialog.Switch
        checked={data.autoRestart}
        onCheckedChange={(v) => setField("autoRestart", v)}
        label="自动重启"
        description="服务异常退出时自动重新启动"
      />

      <FormDialog.Switch
        checked={data.clearLogOnStart}
        onCheckedChange={(v) => setField("clearLogOnStart", v)}
        label="启动时清空日志"
        description="每次启动服务时清空之前的日志文件"
      />

      <FormDialog.Field label="日志路径" hint="留空则不启用">
        <FormDialog.Input
          value={data.logPath}
          onChange={(e) => setField("logPath", e.target.value)}
          placeholder="/var/log/my-service.log"
          className="font-mono"
        />
      </FormDialog.Field>

      <FormDialog.Field label="关闭命令" hint="留空使用 stop">
        <FormDialog.Input
          value={data.shutdownCommand}
          onChange={(e) => setField("shutdownCommand", e.target.value)}
          placeholder="stop"
          className="font-mono"
        />
      </FormDialog.Field>

      <FormDialog.Switch
        checked={data.webEnabled}
        onCheckedChange={(v) => setField("webEnabled", v)}
        label="启用 Web 网关"
        description="通过 Hypercraft 单入口访问该服务的本机 Web 页面"
      />

      {data.webEnabled && (
        <>
          <FormDialog.Field label="Web 上游地址" hint="仅支持宿主机本地地址，例如 http://127.0.0.1:3000">
            <FormDialog.Input
              value={data.webUpstream}
              onChange={(e) => setField("webUpstream", e.target.value)}
              placeholder="http://127.0.0.1:3000"
              className="font-mono"
            />
          </FormDialog.Field>

          <FormDialog.Field label="浏览器标题" hint="留空则使用默认标题">
            <FormDialog.Input
              value={data.webTitle}
              onChange={(e) => setField("webTitle", e.target.value)}
              placeholder="内部工具"
            />
          </FormDialog.Field>

          <FormDialog.Field label="健康检查路径" hint="可选，用于后续健康检查或快速探活">
            <FormDialog.Input
              value={data.webHealthPath}
              onChange={(e) => setField("webHealthPath", e.target.value)}
              placeholder="/"
              className="font-mono"
            />
          </FormDialog.Field>
        </>
      )}
    </div>
  );
}
