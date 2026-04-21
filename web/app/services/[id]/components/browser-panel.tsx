"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  RiGlobalLine,
  RiFullscreenExitLine,
  RiFullscreenLine,
  RiLoader4Line,
  RiRefreshLine,
  RiShieldCheckLine,
} from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as CompactButton from "@/components/ui/compact-button";
import * as Tooltip from "@/components/ui/tooltip";
import { api } from "@/lib/api";

interface BrowserPanelProps {
  serviceId: string;
  title?: string;
  extraActions?: ReactNode;
}

export function BrowserPanel({
  serviceId,
  title,
  extraActions,
}: BrowserPanelProps) {
  const [sessionUrl, setSessionUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [zenMode, setZenMode] = useState(false);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await api.createWebSession(serviceId);
      setSessionUrl(session.url);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      setSessionUrl(null);
      setError(apiErr.message || "创建 Web 会话失败");
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => {
    loadSession();
  }, [loadSession, reloadKey]);

  const toggleZenMode = useCallback(() => {
    setZenMode((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!zenMode) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setZenMode(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [zenMode]);

  return (
    <div
      className={`terminal-dark flex min-h-0 flex-1 flex-col overflow-hidden ${
        zenMode ? "fixed inset-0 z-50" : "rounded-xl border border-white/10"
      }`}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <RiGlobalLine className="size-4 shrink-0 text-neutral-500" />
          <span className="hidden truncate text-sm text-neutral-400 sm:inline">
            {title || `浏览器 - ${serviceId}`}
          </span>
          <span className="text-sm text-neutral-400 sm:hidden">{title || "浏览器"}</span>
        </div>
        <div className="flex items-center gap-1" onDoubleClick={toggleZenMode}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <CompactButton.Root
                variant="ghost"
                className="text-neutral-500 hover:bg-white/10 hover:text-neutral-300"
                disabled={loading}
                onClick={() => setReloadKey((prev) => prev + 1)}
              >
                <CompactButton.Icon as={RiRefreshLine} className={loading ? "animate-spin" : ""} />
              </CompactButton.Root>
            </Tooltip.Trigger>
            <Tooltip.Content>刷新</Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <CompactButton.Root
                variant="ghost"
                className="text-neutral-500 hover:bg-white/10 hover:text-neutral-300"
                onClick={toggleZenMode}
              >
                <CompactButton.Icon as={zenMode ? RiFullscreenExitLine : RiFullscreenLine} />
              </CompactButton.Root>
            </Tooltip.Trigger>
            <Tooltip.Content>{zenMode ? "退出全屏 (ESC)" : "全屏"}</Tooltip.Content>
          </Tooltip.Root>
          {extraActions}
        </div>
      </div>

      {loading && (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[#0a0a0a]">
          <RiLoader4Line className="size-8 animate-spin text-neutral-500" />
        </div>
      )}

      {!loading && error && (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[#0a0a0a] p-6">
          <div className="flex flex-col items-center justify-center text-center">
            <RiShieldCheckLine className="mb-4 size-12 text-neutral-500" />
            <h3 className="text-base font-medium text-neutral-200">无法打开浏览器视图</h3>
            <p className="mt-1 text-sm text-neutral-400">{error}</p>
            <div className="mt-4">
              <Button.Root size="xsmall" onClick={() => setReloadKey((prev) => prev + 1)}>
                重试
              </Button.Root>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && sessionUrl && (
        <div className="min-h-0 flex-1 bg-[#0a0a0a]" onDoubleClick={toggleZenMode}>
          <iframe
            key={sessionUrl}
            src={sessionUrl}
            title={title || "浏览器"}
            className="size-full min-h-0 border-0 bg-bg-white-0"
          />
        </div>
      )}
    </div>
  );
}
