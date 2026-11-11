"use client";

import { useEffect, useMemo, useState } from "react";
import { RiDownloadCloud2Line, RiLoader4Line, RiRefreshLine, RiStackLine } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import * as Select from "@/components/ui/select";
import {
  api,
  type JavaCatalog,
  type JavaCatalogItem,
  type RegistryTool,
  type ToolVersions,
} from "@/lib/api";
import { TOOL_META, toolLabel } from "../tool-meta";

/** Minecraft 版本对照，帮助用户选 Java 主版本 */
const MC_HINT: Record<number, string> = {
  8: "MC 1.16.5 及更早、Forge 旧版",
  11: "少数插件 / 工具",
  17: "MC 1.17 – 1.20.4",
  21: "MC 1.20.5 及更新（推荐）",
  25: "最新 LTS",
};

export interface InstallRuntimeModalProps {
  installedIds: Set<string>;
  onClose: () => void;
  onStarted: () => void;
}

export function InstallRuntimeModal({ installedIds, onClose, onStarted }: InstallRuntimeModalProps) {
  const [tool, setTool] = useState("java");
  const [tools, setTools] = useState<RegistryTool[]>([]);
  const [featured, setFeatured] = useState<RegistryTool[]>([]);
  const [toolSearch, setToolSearch] = useState("");
  const [customId, setCustomId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [spec, setSpec] = useState("");

  useEffect(() => {
    api
      .listRuntimeTools()
      .then((r) => {
        setTools(r.tools);
        setFeatured(r.featured);
      })
      .catch(() => {});
  }, []);

  const toolMatches = useMemo(() => {
    const q = toolSearch.trim().toLowerCase();
    if (!q) return [];
    return tools
      .filter((t) => t.name.includes(q) || t.aliases.some((a) => a.includes(q)) || (t.description ?? "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [tools, toolSearch]);

  const defaultId = tool === "java" ? spec : spec ? `${tool}-${spec}`.toLowerCase().replace(/[^a-z0-9._-]/g, "-") : "";
  const runtimeId = customId.trim() || defaultId;
  const willUpgrade = runtimeId !== "" && installedIds.has(runtimeId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spec) return;
    if (customId.trim() && !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(customId.trim())) {
      setError("ID 只能包含小写字母、数字、点、横线和下划线");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.installRuntime({ tool, spec, id: customId.trim() || undefined, name: name.trim() || undefined });
      onStarted();
    } catch (err: unknown) {
      setError((err as { message?: string }).message || "提交安装失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <FormDialog.Content>
        <form onSubmit={handleSubmit}>
          <FormDialog.Header
            icon={RiStackLine}
            title="安装运行环境"
            description="由内置 mise 下载、校验并安装到数据目录"
          />
          <FormDialog.Body className="space-y-5">
            {error && <FormDialog.Error message={error} />}

            <FormDialog.Field label="工具" required hint={TOOL_META[tool]?.hint}>
              <div className="flex flex-wrap gap-1.5">
                {(featured.length ? featured.map((f) => f.name) : Object.keys(TOOL_META)).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setTool(t);
                      setSpec("");
                      setToolSearch("");
                    }}
                    className={`rounded-md border px-2.5 py-1 text-xs transition ${
                      t === tool
                        ? "border-primary-base bg-primary-base text-static-white"
                        : "border-stroke-soft-200 text-text-sub-600 hover:bg-bg-weak-50"
                    }`}
                  >
                    {toolLabel(t)}
                  </button>
                ))}
                {!TOOL_META[tool] && (
                  <span className="rounded-md border border-primary-base bg-primary-base px-2.5 py-1 font-mono text-xs text-static-white">
                    {tool}
                  </span>
                )}
              </div>
              <div className="relative mt-2">
                <FormDialog.Input
                  value={toolSearch}
                  onChange={(e) => setToolSearch(e.target.value)}
                  placeholder={`搜索其他工具（共 ${tools.length || "…"} 个）`}
                />
                {toolMatches.length > 0 && (
                  <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-stroke-soft-200 bg-bg-white-0 p-1 shadow-regular-md">
                    {toolMatches.map((t) => (
                      <button
                        key={t.name}
                        type="button"
                        className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-bg-weak-50"
                        onClick={() => {
                          setTool(t.name);
                          setSpec("");
                          setToolSearch("");
                        }}
                      >
                        <span className="font-mono text-sm text-text-strong-950">{t.name}</span>
                        {t.description && (
                          <span className="ml-2 truncate text-xs text-text-sub-600">{t.description}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </FormDialog.Field>

            <div className="border-t border-stroke-soft-200" />

            {tool === "java" ? (
              <JavaPicker installedIds={installedIds} onSpec={setSpec} onError={setError} />
            ) : (
              <ToolVersionPicker key={tool} tool={tool} onSpec={setSpec} onError={setError} />
            )}

            {spec && willUpgrade && (
              <div className="rounded-lg bg-warning-lighter px-3 py-2 text-xs text-warning-base">
                「{runtimeId}」已存在，将更新到所选版本，使用它的服务重启后生效
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormDialog.Field label="运行环境 ID" hint="留空自动生成">
                <FormDialog.Input
                  value={customId}
                  onChange={(e) => setCustomId(e.target.value)}
                  placeholder={defaultId || "自动"}
                  className="font-mono"
                />
              </FormDialog.Field>
              <FormDialog.Field label="显示名称" hint="可选">
                <FormDialog.Input value={name} onChange={(e) => setName(e.target.value)} placeholder="自动" />
              </FormDialog.Field>
            </div>
          </FormDialog.Body>

          <FormDialog.Footer>
            <FormDialog.Button type="button" variant="secondary" onClick={onClose}>
              取消
            </FormDialog.Button>
            <FormDialog.Button type="submit" loading={submitting} disabled={!spec} icon={RiDownloadCloud2Line}>
              {willUpgrade ? "更新" : "安装"}
            </FormDialog.Button>
          </FormDialog.Footer>
        </form>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}

/** Java：主版本 × 发行版 */
function JavaPicker({
  installedIds,
  onSpec,
  onError,
}: {
  installedIds: Set<string>;
  onSpec: (spec: string) => void;
  onError: (e: string | null) => void;
}) {
  const [catalog, setCatalog] = useState<JavaCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [major, setMajor] = useState<number>(21);
  const [vendorKey, setVendorKey] = useState<string>("temurin-jre");

  const load = async (refresh = false) => {
    setLoading(true);
    onError(null);
    try {
      setCatalog(await api.getJavaCatalog(refresh));
    } catch (err: unknown) {
      onError((err as { message?: string }).message || "获取可安装版本失败");
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅首次加载
  useEffect(() => {
    load();
  }, []);

  const items = useMemo(() => (catalog?.items ?? []).filter((i) => showAll || i.common), [catalog, showAll]);
  const majors = useMemo(() => Array.from(new Set(items.map((i) => i.major))).sort((a, b) => b - a), [items]);
  const vendorsForMajor = useMemo(() => items.filter((i) => i.major === major), [items, major]);

  useEffect(() => {
    if (majors.length && !majors.includes(major)) setMajor(majors.includes(21) ? 21 : majors[0]);
  }, [majors, major]);
  useEffect(() => {
    if (vendorsForMajor.length && !vendorsForMajor.some((v) => v.vendor_key === vendorKey)) {
      const preferred = ["temurin-jre", "temurin", "zulu-jre", "zulu"];
      const pick = preferred.map((p) => vendorsForMajor.find((v) => v.vendor_key === p)).find(Boolean);
      setVendorKey((pick ?? vendorsForMajor[0]).vendor_key);
    }
  }, [vendorsForMajor, vendorKey]);

  const selected: JavaCatalogItem | undefined = vendorsForMajor.find((v) => v.vendor_key === vendorKey);
  useEffect(() => {
    onSpec(selected?.spec ?? "");
  }, [selected, onSpec]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-sub-600">
        <RiLoader4Line className="size-5 animate-spin" />
        正在获取可安装版本…
      </div>
    );
  }
  if (!catalog) return null;

  const s = catalog.settings;
  const mirrorLabel = s.adoptium_mirror === "tuna" ? "清华镜像" : s.adoptium_mirror === "ustc" ? "中科大镜像" : "官方源";

  return (
    <>
      <FormDialog.Field label="Java 版本" required hint={MC_HINT[major]}>
        <div className="flex flex-wrap gap-2">
          {majors.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMajor(m)}
              className={`h-9 min-w-12 rounded-lg border px-3 font-mono text-sm transition ${
                m === major
                  ? "border-primary-base bg-primary-base font-semibold text-static-white"
                  : "border-stroke-soft-200 text-text-sub-600 hover:bg-bg-weak-50"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </FormDialog.Field>

      <FormDialog.Field label="发行版" required>
        <Select.Root size="medium" value={vendorKey} onValueChange={setVendorKey}>
          <Select.Trigger>
            <Select.Value placeholder="选择发行版" />
          </Select.Trigger>
          <Select.Content>
            {vendorsForMajor.map((v) => (
              <Select.Item key={v.vendor_key} value={v.vendor_key}>
                <span className="truncate">
                  {v.vendor} · {v.image_type.toUpperCase()}
                  {installedIds.has(v.spec) ? " · 已安装" : ""}
                </span>
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </FormDialog.Field>

      {selected && (
        <div className="rounded-lg border border-stroke-soft-200 bg-bg-weak-50 px-3 py-2.5 text-xs text-text-sub-600">
          <div>
            将安装 <span className="font-mono text-text-strong-950">{selected.latest}</span>
          </div>
          <div className="mt-0.5">
            平台 <span className="font-mono">{catalog.arch}</span> · Temurin {mirrorLabel}
            {s.github_proxy ? ` · GitHub 代理 ${s.github_proxy}` : ""}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-text-soft-400">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          显示非常用版本
        </label>
        <button type="button" className="flex items-center gap-1 hover:text-text-sub-600" onClick={() => load(true)}>
          <RiRefreshLine className="size-3.5" />
          刷新 · mise {catalog.mise_version}
        </button>
      </div>
    </>
  );
}

/** 其他工具：推荐通道 + 完整版本列表 */
function ToolVersionPicker({
  tool,
  onSpec,
  onError,
}: {
  tool: string;
  onSpec: (spec: string) => void;
  onError: (e: string | null) => void;
}) {
  const [data, setData] = useState<ToolVersions | null>(null);
  const [loading, setLoading] = useState(true);
  const [value, setValue] = useState("");

  const load = async (refresh = false) => {
    setLoading(true);
    onError(null);
    try {
      const d = await api.getToolVersions(tool, refresh);
      setData(d);
      // Node 默认选最新的偶数版本（LTS 系列）
      const preferred = tool === "node" ? d.channels.find((c) => Number(c) % 2 === 0) : d.channels[0];
      setValue((v) => v || preferred || d.versions[0] || "latest");
    } catch (err: unknown) {
      onError((err as { message?: string }).message || "获取版本列表失败");
      setValue("latest");
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: tool 变化时由 key 重建组件
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    onSpec(value);
  }, [value, onSpec]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-sub-600">
        <RiLoader4Line className="size-5 animate-spin" />
        正在获取 {toolLabel(tool)} 版本…
      </div>
    );
  }

  const latestOf = (prefix: string) =>
    data?.versions.find((v) => v === prefix || v.startsWith(`${prefix}.`)) ?? prefix;

  return (
    <>
      <FormDialog.Field label="版本" required hint="选择通道将安装该系列的最新版本">
        <div className="flex flex-wrap gap-2">
          {["latest", ...(data?.channels ?? [])].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setValue(c)}
              title={c === "latest" ? "最新稳定版" : latestOf(c)}
              className={`h-9 min-w-12 rounded-lg border px-3 font-mono text-sm transition ${
                value === c
                  ? "border-primary-base bg-primary-base font-semibold text-static-white"
                  : "border-stroke-soft-200 text-text-sub-600 hover:bg-bg-weak-50"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </FormDialog.Field>

      {data && data.versions.length > 0 && (
        <FormDialog.Field label="或指定完整版本">
          <Select.Root size="medium" value={data.versions.includes(value) ? value : undefined} onValueChange={setValue}>
            <Select.Trigger>
              <Select.Value placeholder={`共 ${data.versions.length} 个版本`} />
            </Select.Trigger>
            <Select.Content>
              {data.versions.map((v) => (
                <Select.Item key={v} value={v}>
                  <span className="font-mono">{v}</span>
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </FormDialog.Field>
      )}

      <div className="flex items-center justify-between rounded-lg border border-stroke-soft-200 bg-bg-weak-50 px-3 py-2.5 text-xs text-text-sub-600">
        <span>
          将安装 <span className="font-mono text-text-strong-950">{tool}@{value}</span>
          {value !== "latest" && data?.versions.length ? (
            <span className="ml-1 text-text-soft-400">（{latestOf(value)}）</span>
          ) : null}
        </span>
        <button type="button" className="flex items-center gap-1 text-text-soft-400 hover:text-text-sub-600" onClick={() => load(true)}>
          <RiRefreshLine className="size-3.5" />
          刷新
        </button>
      </div>
    </>
  );
}
