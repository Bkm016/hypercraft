"use client";

import { useState } from "react";
import {
  RiDeleteBinLine,
  RiFileCopyLine,
  RiKey2Line,
} from "@remixicon/react";
import * as CompactButton from "@/components/ui/compact-button";
import {
  api,
  type ApiKeySummary,
  type ServiceGroup,
  type ServiceSummary,
} from "@/lib/api";
import { ServicePermissionSummary } from "@/app/users/components/service-permission-summary";
import { notification } from "@/hooks/use-notification";
import { copyText } from "./copy-text";

export interface ApiKeyRowProps {
  apiKey: ApiKeySummary;
  services: ServiceSummary[];
  groups: ServiceGroup[];
  onEdit: () => void;
  onRevoke: () => void;
}

function formatTime(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN");
  } catch {
    return iso;
  }
}

export function ApiKeyRow({
  apiKey,
  services,
  groups,
  onEdit,
  onRevoke,
}: ApiKeyRowProps) {
  const [copying, setCopying] = useState(false);

  const handleCopySecret = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setCopying(true);
    try {
      const resp = await api.revealApiKeySecret(apiKey.id);
      const ok = await copyText(resp.secret);
      notification({
        status: ok ? "success" : "error",
        title: ok ? "已复制完整密钥" : "复制失败",
      });
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      notification({
        status: "error",
        title: apiErr.message || "获取密钥失败",
      });
    } finally {
      setCopying(false);
    }
  };

  return (
    <tr
      className="cursor-pointer border-b border-stroke-soft-200 transition-colors last:border-0 hover:bg-bg-weak-50"
      onClick={onEdit}
    >
      <td className="px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-full bg-bg-weak-50">
            <RiKey2Line className="size-4 text-text-sub-600" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-medium text-text-strong-950">
                {apiKey.name}
              </span>
              {apiKey.revoked_at ? (
                <span className="shrink-0 rounded-md bg-error-lighter px-1.5 py-0.5 text-[11px] font-medium text-error-base">
                  已撤销
                </span>
              ) : (
                <span className="shrink-0 rounded-md bg-success-lighter px-1.5 py-0.5 text-[11px] font-medium text-success-base">
                  有效
                </span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          disabled={copying}
          onClick={handleCopySecret}
          className="inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs text-text-sub-600 transition-colors hover:bg-bg-weak-50 hover:text-text-strong-950 disabled:opacity-50"
          title="复制完整密钥"
        >
          <span className="truncate">{apiKey.key_prefix}…</span>
          <RiFileCopyLine className="size-3.5 shrink-0" />
        </button>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap gap-1">
          {apiKey.scopes.map((s) => (
            <span
              key={s}
              className="rounded bg-bg-weak-50 px-1.5 py-0.5 font-mono text-[11px] text-text-sub-600"
            >
              {s}
            </span>
          ))}
        </div>
      </td>
      <td className="max-w-[12rem] px-4 py-2.5">
        <ServicePermissionSummary
          serviceIds={apiKey.service_ids}
          services={services}
          groups={groups}
          emptyLabel="无"
        />
      </td>
      <td className="px-4 py-3 text-sm text-text-sub-600">
        {formatTime(apiKey.last_used_at)}
      </td>
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        {!apiKey.revoked_at && (
          <CompactButton.Root variant="ghost" size="medium" onClick={onRevoke}>
            <CompactButton.Icon as={RiDeleteBinLine} className="text-error-base" />
          </CompactButton.Root>
        )}
      </td>
    </tr>
  );
}
