"use client";

import { useState } from "react";
import {
  RiDeleteBinLine,
  RiEditLine,
  RiFileCopyLine,
  RiKey2Line,
  RiMoreLine,
} from "@remixicon/react";
import * as CompactButton from "@/components/ui/compact-button";
import * as Dropdown from "@/components/ui/dropdown";
import {
  api,
  type ApiKeySummary,
  type ServiceGroup,
  type ServiceSummary,
} from "@/lib/api";
import { ServicePermissionSummary } from "@/app/users/components/service-permission-summary";
import { notification } from "@/hooks/use-notification";
import { copyText } from "./copy-text";

export interface ApiKeyCardProps {
  apiKey: ApiKeySummary;
  services: ServiceSummary[];
  groups: ServiceGroup[];
  onEdit: () => void;
  onRevoke: () => void;
}

export function ApiKeyCard({
  apiKey,
  services,
  groups,
  onEdit,
  onRevoke,
}: ApiKeyCardProps) {
  const [copying, setCopying] = useState(false);

  const handleCopySecret = async () => {
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
    <div
      className="flex items-center gap-3 rounded-lg border border-stroke-soft-200 bg-bg-white-0 px-3 py-2.5 transition-colors"
      onClick={onEdit}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-bg-weak-50">
        <RiKey2Line className="size-4 text-text-sub-600" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-sm font-medium text-text-strong-950">
            {apiKey.name}
          </div>
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
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <button
            type="button"
            disabled={copying}
            className="inline-flex items-center gap-1 font-mono text-xs text-text-soft-400 disabled:opacity-50"
            onClick={(e) => {
              e.stopPropagation();
              handleCopySecret();
            }}
          >
            {apiKey.key_prefix}…
            <RiFileCopyLine className="size-3" />
          </button>
          <ServicePermissionSummary
            serviceIds={apiKey.service_ids}
            services={services}
            groups={groups}
            emptyLabel="无服务"
          />
        </div>
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <CompactButton.Root variant="ghost" size="medium">
              <CompactButton.Icon as={RiMoreLine} />
            </CompactButton.Root>
          </Dropdown.Trigger>
          <Dropdown.Content align="end" className="w-36">
            <Dropdown.Item onClick={onEdit}>
              <Dropdown.ItemIcon as={RiEditLine} />
              编辑
            </Dropdown.Item>
            <Dropdown.Item onClick={handleCopySecret} disabled={copying}>
              <Dropdown.ItemIcon as={RiFileCopyLine} />
              复制密钥
            </Dropdown.Item>
            {!apiKey.revoked_at && (
              <Dropdown.Item onClick={onRevoke} className="text-error-base">
                <Dropdown.ItemIcon
                  as={RiDeleteBinLine}
                  className="text-error-base"
                />
                撤销
              </Dropdown.Item>
            )}
          </Dropdown.Content>
        </Dropdown.Root>
      </div>
    </div>
  );
}
