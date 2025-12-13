"use client";

import * as FormDialog from "@/components/ui/form-dialog";
import * as SegmentedControl from "@/components/ui/segmented-control";
import type { ScheduleAction } from "@/lib/api";
import type { ServiceFormData } from "./types";

interface ScheduleFieldsProps {
  data: ServiceFormData;
  setField: <K extends keyof ServiceFormData>(field: K, value: ServiceFormData[K]) => void;
  cronError: string | null;
  cronValidating: boolean;
}

export function ScheduleFields({ data, setField, cronError, cronValidating }: ScheduleFieldsProps) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium uppercase tracking-wider text-text-soft-400">
        定时任务
      </h4>

      <SegmentedControl.Root
        value={data.scheduleAction}
        onValueChange={(v) => setField("scheduleAction", v as "none" | ScheduleAction)}
      >
        <SegmentedControl.List>
          <SegmentedControl.Trigger value="none">无</SegmentedControl.Trigger>
          <SegmentedControl.Trigger value="start">启动</SegmentedControl.Trigger>
          <SegmentedControl.Trigger value="restart">重启</SegmentedControl.Trigger>
          <SegmentedControl.Trigger value="stop">停止</SegmentedControl.Trigger>
        </SegmentedControl.List>
      </SegmentedControl.Root>

      {data.scheduleAction !== "none" && (
        <FormDialog.Field
          label="Cron 表达式"
          hint="秒 分 时 日 月 周，如 0 0 8 * * * 表示每天 08:00"
          error={cronError || undefined}
        >
          <FormDialog.Input
            value={data.scheduleCron}
            onChange={(e) => setField("scheduleCron", e.target.value)}
            placeholder="0 0 8 * * *"
            className={`font-mono ${cronError ? "!border-error-base" : ""}`}
          />
          {cronValidating && (
            <span className="text-xs text-text-soft-400">验证中...</span>
          )}
        </FormDialog.Field>
      )}
    </div>
  );
}
