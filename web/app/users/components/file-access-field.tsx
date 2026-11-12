"use client";

import * as FormDialog from "@/components/ui/form-dialog";
import * as SegmentedControl from "@/components/ui/segmented-control";
import type { FileAccess } from "@/lib/api";

const DESCRIPTIONS: Record<FileAccess, string> = {
  none: "看不到服务的「文件」标签",
  read: "可浏览目录、查看配置、下载文件（单个 ≤ 512 MB）",
  write: "另可编辑配置、上传、新建、重命名、移动和删除文件",
};

export interface FileAccessFieldProps {
  value: FileAccess;
  onChange: (value: FileAccess) => void;
  /** 系统管理员恒有读写权限 */
  lockedByAdmin?: boolean;
}

/** 用户的文件管理权限；对其有访问权的全部服务生效 */
export function FileAccessField({ value, onChange, lockedByAdmin }: FileAccessFieldProps) {
  const effective: FileAccess = lockedByAdmin ? "write" : value;
  return (
    <FormDialog.Field label="文件管理权限">
      <SegmentedControl.Root
        value={effective}
        onValueChange={(v) => !lockedByAdmin && onChange(v as FileAccess)}
      >
        <SegmentedControl.List>
          <SegmentedControl.Trigger value="none" disabled={lockedByAdmin}>
            无
          </SegmentedControl.Trigger>
          <SegmentedControl.Trigger value="read" disabled={lockedByAdmin}>
            只读
          </SegmentedControl.Trigger>
          <SegmentedControl.Trigger value="write" disabled={lockedByAdmin}>
            读写
          </SegmentedControl.Trigger>
        </SegmentedControl.List>
      </SegmentedControl.Root>
      <p className="text-xs text-text-sub-600">
        {lockedByAdmin ? "系统管理员始终拥有读写权限" : `${DESCRIPTIONS[effective]}；对已授权的全部服务生效`}
      </p>
    </FormDialog.Field>
  );
}
