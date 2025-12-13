"use client";

import * as FormDialog from "@/components/ui/form-dialog";
import type { ServiceFormData } from "./types";

interface CommandFieldsProps {
  data: ServiceFormData;
  setField: <K extends keyof ServiceFormData>(field: K, value: ServiceFormData[K]) => void;
}

export function CommandFields({ data, setField }: CommandFieldsProps) {
  return (
    <div className="space-y-4">
      <h4 className="text-xs font-medium uppercase tracking-wider text-text-soft-400">
        启动配置
      </h4>

      <FormDialog.Field label="启动命令" required>
        <FormDialog.Input
          placeholder="node 或 python"
          value={data.command}
          onChange={(e) => setField("command", e.target.value)}
          className="font-mono"
        />
      </FormDialog.Field>

      <FormDialog.Field label="命令参数" hint="每行一个参数">
        <FormDialog.Textarea
          placeholder="server.js&#10;--port&#10;3000"
          value={data.args.join("\n")}
          onChange={(e) => setField("args", e.target.value.split(/\r?\n/))}
          className="font-mono min-h-10 text-sm field-sizing-content break-all"
        />
      </FormDialog.Field>

      <FormDialog.Field label="工作目录" hint="留空使用默认">
        <FormDialog.Input
          placeholder="/home/app/my-service"
          value={data.cwd}
          onChange={(e) => setField("cwd", e.target.value)}
          className="font-mono"
        />
      </FormDialog.Field>

      <FormDialog.Field label="运行用户" hint="仅限 Linux，留空使用当前用户">
        <FormDialog.Input
          placeholder="www-data"
          value={data.runAs}
          onChange={(e) => setField("runAs", e.target.value)}
          className="font-mono"
        />
      </FormDialog.Field>
    </div>
  );
}
