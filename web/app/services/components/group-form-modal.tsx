"use client";

import { useState, useEffect } from "react";
import { RiEditLine, RiFolderLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import { api, type ServiceGroup } from "@/lib/api";
import { notification } from "@/hooks/use-notification";
import { GroupColorPicker, PRESET_COLORS } from "./group-color-picker";

export interface GroupFormModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** 编辑模式时传入现有分组 */
  group?: ServiceGroup;
}

export function GroupFormModal({
  open,
  onClose,
  onSuccess,
  group,
}: GroupFormModalProps) {
  const isEditMode = !!group;

  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);

  // 当弹窗打开或 group 变化时初始化表单
  useEffect(() => {
    if (open) {
      if (group) {
        setName(group.name);
        setColor(group.color || PRESET_COLORS[0]);
      } else {
        setName("");
        setColor(PRESET_COLORS[0]);
      }
    }
  }, [open, group]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      if (isEditMode) {
        await api.updateGroup(group!.id, { name: name.trim(), color });
        notification({ status: "success", title: "分组已更新" });
      } else {
        const id = `group-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        await api.createGroup({ id, name: name.trim(), color });
        notification({ status: "success", title: "分组已创建" });
      }
      onSuccess();
    } catch (err) {
      const apiErr = err as { message?: string };
      notification({
        status: "error",
        title: isEditMode ? "更新失败" : "创建失败",
        description: apiErr.message || (isEditMode ? "更新分组失败" : "创建分组失败"),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <FormDialog.Content>
        <form onSubmit={handleSubmit}>
          <FormDialog.Header
            icon={isEditMode ? RiEditLine : RiFolderLine}
            title={isEditMode ? "编辑分组" : "新建分组"}
            description={isEditMode ? "编辑分组的名称和颜色" : "创建一个新的服务分组"}
          />
          <FormDialog.Body className="space-y-4">
            <FormDialog.Field label="分组名称" required>
              <FormDialog.Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入分组名称"
                autoFocus
              />
            </FormDialog.Field>
            <FormDialog.Field label="分组颜色">
              <GroupColorPicker value={color} onChange={setColor} />
            </FormDialog.Field>
          </FormDialog.Body>
          <FormDialog.Footer>
            <FormDialog.Button type="button" variant="secondary" onClick={onClose}>
              取消
            </FormDialog.Button>
            <FormDialog.Button type="submit" loading={saving} disabled={!name.trim()}>
              {isEditMode ? "保存" : "创建"}
            </FormDialog.Button>
          </FormDialog.Footer>
        </form>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
