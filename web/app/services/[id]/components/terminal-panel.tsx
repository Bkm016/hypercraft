"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import {
  RiTerminalBoxLine,
  RiCloseLine,
  RiFullscreenLine,
  RiFullscreenExitLine,
} from "@remixicon/react";
import * as CompactButton from "@/components/ui/compact-button";
import * as Tooltip from "@/components/ui/tooltip";
import { QuickCommands } from "./quick-commands";
import { useTerminal, type TerminalStatus } from "@/hooks/use-terminal";
import { useXterm } from "@/hooks/use-xterm";

export interface TerminalPanelProps {
  serviceId: string;
}

// 状态配置
const statusConfig: Record<TerminalStatus, { label: string; color: string; dotColor: string }> = {
  disconnected: { label: "未连接", color: "text-neutral-500", dotColor: "bg-neutral-500" },
  connecting: { label: "连接中", color: "text-yellow-400", dotColor: "bg-yellow-400" },
  connected: { label: "已连接", color: "text-green-400", dotColor: "bg-green-400" },
  error: { label: "连接错误", color: "text-red-400", dotColor: "bg-red-400" },
};

export function TerminalPanel({ serviceId }: TerminalPanelProps) {
  const [zenMode, setZenMode] = useState(false);
  const lastTapRef = useRef<number>(0);

  // 使用 xterm hook
  const {
    containerRef,
    wrapperRef,
    terminalRef,
    xtermRef,
    isInitialized,
    write,
    writeln,
    clear,
    scrollToCursor,
  } = useXterm({
    readOnly: false,
    showCursor: true,
    smartTrim: true,
    initialRows: 20,
  });

  // 处理终端数据
  const handleData = useCallback((data: string) => {
    write(data);
  }, [write]);

  // 使用终端 Hook（自动连接）
  const { status, error, disconnect, sendInput } = useTerminal({
    serviceId,
    autoConnect: true,
    onData: handleData,
  });

  // 处理终端输入
  useEffect(() => {
    if (!xtermRef.current || status !== "connected") return;

    const terminal = xtermRef.current;
    const disposable = terminal.onData((data) => {
      sendInput(data);
    });

    return () => {
      disposable.dispose();
    };
  }, [status, sendInput, xtermRef]);

  // 初始化完成后显示欢迎信息
  useEffect(() => {
    if (!isInitialized) return;

    writeln("\x1b[1;36m╭────────────────────────╮\x1b[0m");
    writeln("\x1b[1;36m│\x1b[0m  \x1b[1;33mHypercraft Terminal\x1b[0m   \x1b[1;36m│\x1b[0m");
    writeln("\x1b[1;36m╰────────────────────────╯\x1b[0m");
    writeln("");

    // 滚动到顶部
    setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = 0;
      }
    }, 100);
  }, [isInitialized, writeln, containerRef]);

  // 连接状态变化时的提示
  const prevStatusRef = useRef<TerminalStatus>("disconnected");
  const lastErrorRef = useRef<string | null>(null);
  const retryCountRef = useRef(0);

  useEffect(() => {
    if (!xtermRef.current) return;

    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    if (status === "connecting") {
      if (prevStatus === "disconnected") {
        writeln("\x1b[1;33m正在连接...\x1b[0m");
        retryCountRef.current = 0;
        lastErrorRef.current = null;
      }
    } else if (status === "connected") {
      retryCountRef.current = 0;
      lastErrorRef.current = null;
    } else if (status === "disconnected" && isInitialized) {
      writeln("\x1b[1;33m连接已断开\x1b[0m");
      retryCountRef.current = 0;
      lastErrorRef.current = null;
    } else if (status === "error" && error) {
      retryCountRef.current++;
      if (lastErrorRef.current !== error) {
        lastErrorRef.current = error;
        writeln(`\x1b[1;31m${error}，正在重连...\x1b[0m`);
      }
    }
  }, [status, error, isInitialized, writeln, xtermRef]);

  // 断开连接清理
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  // Zen 模式切换
  const toggleZenMode = useCallback(() => {
    setZenMode((prev) => !prev);
  }, []);

  // 移动端双击处理
  const handleTouchEnd = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      toggleZenMode();
    }
    lastTapRef.current = now;
  }, [toggleZenMode]);

  // ESC 键退出 Zen 模式
  useEffect(() => {
    if (!zenMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setZenMode(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [zenMode]);

  const currentStatus = statusConfig[status];

  return (
    <div className={`terminal-dark flex min-h-0 flex-1 flex-col overflow-hidden ${
      zenMode ? "fixed inset-0 z-50" : "rounded-xl border border-white/10"
    }`}>
      {/* 头部工具栏 */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <RiTerminalBoxLine className="size-4 text-neutral-500 shrink-0" />
          <span className="text-sm text-neutral-400 truncate hidden sm:inline">终端 - {serviceId}</span>
          <span className="text-sm text-neutral-400 sm:hidden">终端</span>
          {/* 连接状态指示器 */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`size-2 rounded-full ${currentStatus.dotColor} ${status === "connecting" ? "animate-pulse" : ""}`} />
            <span className={`text-xs ${currentStatus.color} hidden sm:inline`}>{currentStatus.label}</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* 快捷指令 */}
          <QuickCommands serviceId={serviceId} onSend={sendInput} />

          {/* Zen 模式按钮 */}
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
            <Tooltip.Content>{zenMode ? "退出全屏 (ESC)" : "全屏模式"}</Tooltip.Content>
          </Tooltip.Root>

          {/* 清空按钮 */}
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <CompactButton.Root
                variant="ghost"
                className="text-neutral-500 hover:bg-white/10 hover:text-neutral-300"
                onClick={clear}
              >
                <CompactButton.Icon as={RiCloseLine} />
              </CompactButton.Root>
            </Tooltip.Trigger>
            <Tooltip.Content>清空终端</Tooltip.Content>
          </Tooltip.Root>
        </div>
      </div>

      {/* 终端容器 */}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto bg-[#0a0a0a]"
        onDoubleClick={toggleZenMode}
        onTouchEnd={handleTouchEnd}
      >
        <div ref={wrapperRef} className="overflow-x-auto overflow-y-hidden">
          <div ref={terminalRef} className="p-2" />
        </div>
      </div>
    </div>
  );
}
