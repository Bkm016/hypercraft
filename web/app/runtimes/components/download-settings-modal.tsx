"use client";

import { useEffect, useState } from "react";
import { RiSettings3Line } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import { api, type AdoptiumMirror } from "@/lib/api";
import { notification } from "@/hooks/use-notification";

const MIRRORS: { id: AdoptiumMirror; label: string; description: string }[] = [
  { id: "tuna", label: "清华大学 TUNA", description: "mirrors.tuna.tsinghua.edu.cn，国内推荐" },
  { id: "ustc", label: "中国科学技术大学", description: "mirrors.ustc.edu.cn" },
  { id: "official", label: "官方（GitHub）", description: "海外服务器使用" },
];

const PROXIES = ["", "https://ghfast.top/", "https://gh-proxy.com/"];

export interface DownloadSettingsModalProps {
  onClose: () => void;
}

export function DownloadSettingsModal({ onClose }: DownloadSettingsModalProps) {
  const [mirror, setMirror] = useState<AdoptiumMirror>("official");
  const [proxy, setProxy] = useState("");
  const [cn, setCn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getRuntimeSettings()
      .then((s) => {
        setMirror(s.adoptium_mirror);
        setProxy(s.github_proxy);
        setCn(s.cn_mirrors);
      })
      .catch((err: { message?: string }) => setError(err.message || "读取配置失败"))
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.updateRuntimeSettings({ adoptium_mirror: mirror, github_proxy: proxy.trim(), cn_mirrors: cn });
      notification({ status: "success", title: "下载源已保存" });
      onClose();
    } catch (err: unknown) {
      setError((err as { message?: string }).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <FormDialog.Content>
        <form onSubmit={handleSubmit}>
          <FormDialog.Header
            icon={RiSettings3Line}
            title="下载源"
            description="写入内置 mise 的 url_replacements，所有下载均按官方校验和校验"
          />
          <FormDialog.Body className="space-y-6">
            {error && <FormDialog.Error message={error} />}

            <FormDialog.Field label="Java（Temurin）镜像" hint="Eclipse Temurin 的下载地址">
              <div className="space-y-2">
                {MIRRORS.map((m) => (
                  <label
                    key={m.id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-stroke-soft-200 px-3 py-2.5 hover:bg-bg-weak-50"
                  >
                    <input
                      type="radio"
                      name="mirror"
                      className="mt-1"
                      checked={mirror === m.id}
                      disabled={loading}
                      onChange={() => setMirror(m.id)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-text-strong-950">{m.label}</span>
                      <span className="block text-xs text-text-sub-600">{m.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </FormDialog.Field>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-stroke-soft-200 px-3 py-2.5 hover:bg-bg-weak-50">
              <input type="checkbox" className="mt-1" checked={cn} disabled={loading} onChange={(e) => setCn(e.target.checked)} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text-strong-950">Node.js / Python / Go 使用国内镜像</span>
                <span className="block text-xs text-text-sub-600">npmmirror.com（Node、Python）与 golang.google.cn（Go）</span>
              </span>
            </label>

            <FormDialog.Field
              label="GitHub 代理"
              hint="Dragonwell、Kona、Bun、Gradle 等托管在 GitHub 的工具使用；以上镜像优先"
            >
              <FormDialog.Input
                value={proxy}
                disabled={loading}
                onChange={(e) => setProxy(e.target.value)}
                placeholder="留空直连，例如 https://ghfast.top/"
                className="font-mono"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {PROXIES.map((p) => (
                  <button
                    key={p || "none"}
                    type="button"
                    onClick={() => setProxy(p)}
                    className="rounded-md border border-stroke-soft-200 px-2 py-0.5 font-mono text-xs text-text-sub-600 hover:bg-bg-weak-50"
                  >
                    {p || "直连"}
                  </button>
                ))}
              </div>
            </FormDialog.Field>
          </FormDialog.Body>
          <FormDialog.Footer>
            <FormDialog.Button type="button" variant="secondary" onClick={onClose}>
              取消
            </FormDialog.Button>
            <FormDialog.Button type="submit" loading={saving} disabled={loading}>
              保存
            </FormDialog.Button>
          </FormDialog.Footer>
        </form>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
