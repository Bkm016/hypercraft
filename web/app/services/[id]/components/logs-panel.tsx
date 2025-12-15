"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  RiLoader4Line,
  RiCloseLine,
  RiRefreshLine,
  RiFileTextLine,
  RiDownloadLine,
} from "@remixicon/react";
import * as Tooltip from "@/components/ui/tooltip";
import * as CompactButton from "@/components/ui/compact-button";
import { notification } from "@/hooks/use-notification";
import { useXterm } from "@/hooks/use-xterm";
import { api } from "@/lib/api";

// Base64 解码为 Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export interface LogsPanelProps {
  serviceId: string;
  serviceState?: "running" | "stopped" | "unknown";
  /** 服务配置的日志文件路径，如果配置了则显示下载按钮 */
  logPath?: string;
}

export function LogsPanel({ serviceId, serviceState, logPath }: LogsPanelProps) {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);
  const [downloading, setDownloading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const prevStateRef = useRef(serviceState);

  // 使用 xterm hook
  const {
    containerRef,
    wrapperRef,
    terminalRef,
    xtermRef,
    isInitialized,
    write,
    clear,
    reset,
    scrollToCursor,
  } = useXterm({
    readOnly: true,
    showCursor: false,
    smartTrim: false,
    initialRows: 3,
  });

  // 加载历史日志（base64 编码的 raw 数据）
  const loadLogs = useCallback(async () => {
    if (!xtermRef.current) return;

    try {
      setLoading(true);
      clear();
      reset();

      const data = await api.getServiceLogsRaw(serviceId, 64 * 1024);
      if (data.data) {
        const bytes = base64ToUint8Array(data.data);
        write(bytes);
      }

      setTimeout(scrollToCursor, 50);
    } catch (err: unknown) {
      console.error("Failed to load logs:", err);
    } finally {
      setLoading(false);
    }
  }, [serviceId, xtermRef, clear, reset, write, scrollToCursor]);

  // 连接 SSE 日志流（base64 编码的 raw 数据）
  const connectLogStream = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    setConnected(false);

    const controller = new AbortController();
    abortRef.current = controller;

    const startStream = async () => {
      try {
        const response = await fetch(
          `${api.getBaseUrl()}/services/${serviceId}/logs?follow=true`,
          {
            headers: {
              Authorization: `Bearer ${api.getAccessToken()}`,
              Accept: "text/event-stream",
            },
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        setConnected(true);

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data:")) {
              const base64Data = line.slice(5).trim();
              if (base64Data && xtermRef.current) {
                try {
                  const bytes = base64ToUint8Array(base64Data);
                  write(bytes);
                } catch {
                  // 忽略解码错误
                }
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("SSE stream error:", err);
        }
      } finally {
        setConnected(false);
      }
    };

    startStream();
  }, [serviceId, xtermRef, write]);

  // 初始化后加载日志并连接流
  useEffect(() => {
    if (isInitialized) {
      loadLogs().then(() => {
        if (serviceState === "running") {
          connectLogStream();
        }
      });
    }

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [isInitialized, serviceState, loadLogs, connectLogStream, reconnectKey]);

  // 监听服务状态变化
  useEffect(() => {
    if (prevStateRef.current === "stopped" && serviceState === "running") {
      clear();
      reset();
      setReconnectKey(k => k + 1);
    }
    prevStateRef.current = serviceState;
  }, [serviceState, clear, reset]);

  // 下载日志文件
  const handleDownloadLogFile = useCallback(async () => {
    if (!logPath) return;
    setDownloading(true);
    try {
      await api.downloadServiceLogFile(serviceId);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      notification({
        status: "error",
        title: apiErr.message || "下载日志文件失败",
      });
    } finally {
      setDownloading(false);
    }
  }, [serviceId, logPath]);

  // 手动刷新
  const handleRefresh = useCallback(() => {
    setReconnectKey(k => k + 1);
  }, []);

  // 清空日志
  const handleClear = useCallback(() => {
    clear();
    reset();
  }, [clear, reset]);

  return (
    <div className="terminal-dark flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10">
      {/* 头部工具栏 */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <RiFileTextLine className="size-4 text-neutral-500 shrink-0" />
          <span className="text-sm text-neutral-400 truncate hidden sm:inline">日志 - {serviceId}</span>
          <span className="text-sm text-neutral-400 sm:hidden">日志</span>
          {/* 连接状态指示器 */}
          {serviceState === "running" && (
            <div className="flex items-center gap-1.5 shrink-0">
              {connected ? (
                <>
                  <span className="size-2 rounded-full bg-green-400" />
                  <span className="text-xs text-green-400 hidden sm:inline">实时</span>
                </>
              ) : (
                <>
                  <span className="size-2 rounded-full bg-yellow-400 animate-pulse" />
                  <span className="text-xs text-yellow-400 hidden sm:inline">连接中</span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* 刷新按钮 */}
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <CompactButton.Root
                variant="ghost"
                className="text-neutral-500 hover:bg-white/10 hover:text-neutral-300"
                onClick={handleRefresh}
                disabled={loading}
              >
                <CompactButton.Icon as={RiRefreshLine} className={loading ? "animate-spin" : ""} />
              </CompactButton.Root>
            </Tooltip.Trigger>
            <Tooltip.Content>刷新日志</Tooltip.Content>
          </Tooltip.Root>

          {/* 下载日志文件按钮 */}
          {logPath && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <CompactButton.Root
                  variant="ghost"
                  className="text-neutral-500 hover:bg-white/10 hover:text-neutral-300"
                  onClick={handleDownloadLogFile}
                  disabled={downloading}
                >
                  <CompactButton.Icon as={downloading ? RiLoader4Line : RiDownloadLine} className={downloading ? "animate-spin" : ""} />
                </CompactButton.Root>
              </Tooltip.Trigger>
              <Tooltip.Content>下载日志文件</Tooltip.Content>
            </Tooltip.Root>
          )}

          {/* 清空按钮 */}
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <CompactButton.Root
                variant="ghost"
                className="text-neutral-500 hover:bg-white/10 hover:text-neutral-300"
                onClick={handleClear}
              >
                <CompactButton.Icon as={RiCloseLine} />
              </CompactButton.Root>
            </Tooltip.Trigger>
            <Tooltip.Content>清空日志</Tooltip.Content>
          </Tooltip.Root>
        </div>
      </div>

      {/* 日志内容区 */}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto bg-[#0a0a0a]"
      >
        <div ref={wrapperRef} className="overflow-x-auto overflow-y-hidden">
          <div ref={terminalRef} className="p-2" />
        </div>
        {loading && !isInitialized && (
          <div className="flex items-center justify-center py-10">
            <RiLoader4Line className="size-6 animate-spin text-neutral-500" />
          </div>
        )}
      </div>
    </div>
  );
}
