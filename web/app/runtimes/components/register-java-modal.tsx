"use client";

import { useState } from "react";
import { RiFolderAddLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import { api } from "@/lib/api";

export interface RegisterJavaModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function RegisterJavaModal({ onClose, onSuccess }: RegisterJavaModalProps) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [home, setHome] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id.trim())) {
      setError("ID 只能包含小写字母、数字、点、横线和下划线");
      return;
    }
    if (!home.trim().startsWith("/") && !/^[A-Za-z]:[\\/]/.test(home.trim())) {
      setError("JAVA_HOME 必须是绝对路径");
      return;
    }
    setLoading(true);
    try {
      await api.registerJavaRuntime({ id: id.trim(), name: name.trim() || undefined, home: home.trim() });
      onSuccess();
    } catch (err: unknown) {
      setError((err as { message?: string }).message || "登记失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <FormDialog.Content>
        <form onSubmit={handleSubmit}>
          <FormDialog.Header
            icon={RiFolderAddLine}
            title="登记已有 Java"
            description="使用服务器上已经存在的 JDK / JRE 目录，删除登记不会删除文件"
          />
          <FormDialog.Body className="space-y-5">
            {error && <FormDialog.Error message={error} />}
            <FormDialog.Field label="JAVA_HOME" required hint="目录下需要有 bin/java">
              <FormDialog.Input
                value={home}
                onChange={(e) => setHome(e.target.value)}
                placeholder="/services/jdk-21"
                className="font-mono"
              />
            </FormDialog.Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormDialog.Field label="运行环境 ID" required>
                <FormDialog.Input
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  placeholder="graalvm-21"
                  className="font-mono"
                />
              </FormDialog.Field>
              <FormDialog.Field label="显示名称" hint="可选">
                <FormDialog.Input value={name} onChange={(e) => setName(e.target.value)} placeholder="GraalVM 21" />
              </FormDialog.Field>
            </div>
          </FormDialog.Body>
          <FormDialog.Footer>
            <FormDialog.Button type="button" variant="secondary" onClick={onClose}>
              取消
            </FormDialog.Button>
            <FormDialog.Button type="submit" loading={loading} icon={RiFolderAddLine}>
              登记
            </FormDialog.Button>
          </FormDialog.Footer>
        </form>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
