"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// 固定尺寸，与后端 PTY 完全一致
export const PTY_ROWS = 300;
export const PTY_COLS = 155;

// xterm 主题配置
const XTERM_THEME = {
  background: "#0a0a0a",
  foreground: "#d4d4d4",
  selectionBackground: "rgba(255, 255, 255, 0.2)",
  black: "#1e1e1e",
  red: "#f44747",
  green: "#608b4e",
  yellow: "#dcdcaa",
  blue: "#569cd6",
  magenta: "#c586c0",
  cyan: "#4ec9b0",
  white: "#d4d4d4",
  brightBlack: "#808080",
  brightRed: "#f44747",
  brightGreen: "#608b4e",
  brightYellow: "#dcdcaa",
  brightBlue: "#569cd6",
  brightMagenta: "#c586c0",
  brightCyan: "#4ec9b0",
  brightWhite: "#ffffff",
};

export interface UseXtermOptions {
  /** 是否只读模式（禁用输入） */
  readOnly?: boolean;
  /** 是否显示光标 */
  showCursor?: boolean;
  /** 是否启用智能裁剪（扫描下方内容） */
  smartTrim?: boolean;
  /** 初始高度（行数） */
  initialRows?: number;
}

export interface UseXtermReturn {
  /** 外部滚动容器 ref */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 裁剪层 ref */
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  /** xterm 挂载点 ref */
  terminalRef: React.RefObject<HTMLDivElement | null>;
  /** xterm 实例 ref */
  xtermRef: React.RefObject<import("@xterm/xterm").Terminal | null>;
  /** 是否已初始化 */
  isInitialized: boolean;
  /** 写入数据到终端 */
  write: (data: string | Uint8Array) => void;
  /** 写入一行数据 */
  writeln: (data: string) => void;
  /** 清空终端 */
  clear: () => void;
  /** 重置终端 */
  reset: () => void;
  /** 滚动到光标位置并裁剪空白 */
  scrollToCursor: () => void;
}

export function useXterm(options: UseXtermOptions = {}): UseXtermReturn {
  const {
    readOnly = false,
    showCursor = true,
    smartTrim = false,
    initialRows = 3,
  } = options;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // 检查是否滚动到底部（带阈值）
  const isAtBottom = useCallback((threshold = 50) => {
    if (!containerRef.current) return true;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    return scrollHeight - scrollTop - clientHeight <= threshold;
  }, []);

  // 裁剪空白行并滚动到光标（仅在滚动条位于底部时追踪）
  const scrollToCursor = useCallback(() => {
    if (!xtermRef.current || !containerRef.current || !wrapperRef.current) return;

    const term = xtermRef.current;
    const buffer = term.buffer.active;
    const cursorRow = buffer.baseY + buffer.cursorY;

    const cellHeight = (term as any)._core._renderService?.dimensions?.css?.cell?.height;
    if (!cellHeight) return;

    let lastContentRow = cursorRow;

    if (smartTrim) {
      // 从光标往下扫描，找连续有内容的区域（遇到空行停止）
      for (let i = cursorRow + 1; i <= cursorRow + 20 && i < buffer.baseY + term.rows; i++) {
        const line = buffer.getLine(i);
        if (!line) break;
        // 检查第一个单元格是否有内容
        const firstCell = line.getCell(0);
        if (!firstCell || firstCell.getChars() === '' || firstCell.getChars() === ' ') {
          const text = line.translateToString(true);
          if (text.trim() === '') {
            break;
          }
        }
        lastContentRow = i;
      }
    }

    // 记录当前是否在底部（在改变高度前检查）
    const wasAtBottom = isAtBottom();

    // 裁剪：最后内容行 + 2 行余量
    const visibleRows = Math.min(lastContentRow + 2, PTY_ROWS);
    wrapperRef.current.style.height = `${visibleRows * cellHeight + 16}px`;

    // 仅当之前在底部时才自动滚动追踪
    if (wasAtBottom) {
      const contentBottom = (lastContentRow + 2) * cellHeight;
      const viewportBottom = containerRef.current.scrollTop + containerRef.current.clientHeight;

      if (contentBottom > viewportBottom) {
        containerRef.current.scrollTop = contentBottom - containerRef.current.clientHeight;
      }
    }
  }, [smartTrim, isAtBottom]);

  // 初始化 xterm.js
  useEffect(() => {
    let mounted = true;

    const initTerminal = async () => {
      if (!terminalRef.current || xtermRef.current) return;

      const [{ Terminal }, { WebLinksAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-web-links"),
      ]);

      if (!mounted || !terminalRef.current) return;

      const isMobile = window.matchMedia("(max-width: 640px)").matches;

      const terminal = new Terminal({
        cursorBlink: showCursor,
        disableStdin: readOnly,
        fontSize: isMobile ? 11 : 13,
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
        rows: PTY_ROWS,
        cols: PTY_COLS,
        theme: {
          ...XTERM_THEME,
          cursor: showCursor ? "#d4d4d4" : "#0a0a0a",
          cursorAccent: showCursor ? "#0a0a0a" : "#0a0a0a",
        },
        allowProposedApi: true,
        scrollback: 0,
        convertEol: true,
      });

      terminal.loadAddon(new WebLinksAddon());
      terminal.open(terminalRef.current);

      // 拦截 xterm 所有滚轮事件，转发给外部容器
      const wheelHandler = (e: Event) => {
        const wheelEvent = e as WheelEvent;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (containerRef.current) {
          containerRef.current.scrollBy(0, wheelEvent.deltaY);
        }
      };

      // 在多个层级拦截
      terminalRef.current.addEventListener('wheel', wheelHandler, { passive: false, capture: true });
      const viewport = terminalRef.current.querySelector('.xterm-viewport');
      if (viewport) {
        viewport.addEventListener('wheel', wheelHandler, { passive: false, capture: true });
      }

      xtermRef.current = terminal;

      // 初始设置高度
      setTimeout(() => {
        if (wrapperRef.current) {
          const cellHeight = (terminal as any)._core._renderService?.dimensions?.css?.cell?.height;
          if (cellHeight) {
            wrapperRef.current.style.height = `${initialRows * cellHeight + 16}px`;
          }
        }
      }, 50);

      setIsInitialized(true);
    };

    initTerminal();

    return () => {
      mounted = false;
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
      }
    };
  }, [readOnly, showCursor, initialRows]);

  // 写入数据
  const write = useCallback((data: string | Uint8Array) => {
    if (xtermRef.current) {
      xtermRef.current.write(data);
      setTimeout(scrollToCursor, 20);
    }
  }, [scrollToCursor]);

  // 写入一行
  const writeln = useCallback((data: string) => {
    if (xtermRef.current) {
      xtermRef.current.writeln(data);
      setTimeout(scrollToCursor, 20);
    }
  }, [scrollToCursor]);

  // 清空终端
  const clear = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.clear();
    }
  }, []);

  // 重置终端
  const reset = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.reset();
    }
  }, []);

  return {
    containerRef,
    wrapperRef,
    terminalRef,
    xtermRef,
    isInitialized,
    write,
    writeln,
    clear,
    reset,
    scrollToCursor,
  };
}
