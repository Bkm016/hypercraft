"use client";

import { useEffect, useState } from "react";
import { RiDeleteBinLine, RiFileAddLine, RiFolderAddLine, RiEditLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";

export type FileDialogState =
  | { kind: "create-file"; dir: string }
  | { kind: "create-dir"; dir: string }
  | { kind: "rename"; path: string; name: string; isDir: boolean }
  | { kind: "delete"; paths: string[] }
  | null;

export interface FileDialogProps {
  state: FileDialogState;
  onClose: () => void;
  /** 返回错误信息字符串表示失败（保持弹窗）；返回 undefined 表示成功 */
  onSubmit: (state: NonNullable<FileDialogState>, name: string) => Promise<string | undefined>;
}

const CONFIG_EXT = /\.(ya?ml|json|toml)$/i;

export function FileDialog({ state, onClose, onSubmit }: FileDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setError(null);
    setLoading(false);
    if (!state) return;
    if (state.kind === "rename") setName(state.name);
    else if (state.kind === "create-file") setName("config.yml");
    else if (state.kind === "create-dir") setName("");
  }, [state]);

  if (!state) return null;

  const meta = {
    "create-file": { icon: RiFileAddLine, title: "新建配置文件", desc: `位置：/${state.kind === "create-file" ? state.dir : ""}`, ok: "创建" },
    "create-dir": { icon: RiFolderAddLine, title: "新建文件夹", desc: `位置：/${state.kind === "create-dir" ? state.dir : ""}`, ok: "创建" },
    rename: { icon: RiEditLine, title: "重命名", desc: state.kind === "rename" ? `/${state.path}` : "", ok: "确定" },
    delete: {
      icon: RiDeleteBinLine,
      title: "确认删除",
      desc: state.kind === "delete" ? (state.paths.length === 1 ? `/${state.paths[0]}` : `共 ${state.paths.length} 项`) : "",
      ok: "删除",
    },
  }[state.kind];

  const validate = (): string | null => {
    if (state.kind === "delete") return null;
    const n = name.trim();
    if (!n) return "名称不能为空";
    if (/[\\/:*?"<>|]/.test(n)) return "名称不能包含 \\ / : * ? \" < > |";
    if (n === "." || n === "..") return "非法名称";
    if (state.kind === "create-file" && !CONFIG_EXT.test(n)) return "仅支持新建 .yml / .yaml / .json / .toml 文件";
    return null;
  };

  const submit = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setLoading(true);
    const err = await onSubmit(state, name.trim());
    setLoading(false);
    if (err) setError(err);
    else onClose();
  };

  const isDelete = state.kind === "delete";

  return (
    <FormDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <FormDialog.Content>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <FormDialog.Header
            icon={meta.icon}
            iconClassName={isDelete ? "text-error-base" : undefined}
            title={meta.title}
            description={meta.desc}
          />
          <FormDialog.Body>
            {isDelete ? (
              <FormDialog.Error
                message={
                  state.paths.length === 1
                    ? "删除后无法恢复。如果是文件夹，其中的所有内容都会被删除。"
                    : `将删除 ${state.paths.length} 个项目，删除后无法恢复。`
                }
              />
            ) : (
              <FormDialog.Field label="名称" error={error ?? undefined}>
                <FormDialog.Input
                  autoFocus
                  value={name}
                  hasError={!!error}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                  onFocus={(e) => {
                    // 选中主文件名，不含扩展名
                    const dot = e.target.value.lastIndexOf(".");
                    const isDir = state.kind === "create-dir" || (state.kind === "rename" && state.isDir);
                    e.target.setSelectionRange(0, dot > 0 && !isDir ? dot : e.target.value.length);
                  }}
                />
              </FormDialog.Field>
            )}
            {isDelete && error && <FormDialog.Error message={error} />}
          </FormDialog.Body>
          <FormDialog.Footer>
            <FormDialog.Button type="button" variant="secondary" onClick={onClose}>
              取消
            </FormDialog.Button>
            <FormDialog.Button type="submit" variant={isDelete ? "danger" : "primary"} loading={loading}>
              {meta.ok}
            </FormDialog.Button>
          </FormDialog.Footer>
        </form>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
