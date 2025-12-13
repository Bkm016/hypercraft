"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export type TerminalStatus = "disconnected" | "connecting" | "connected" | "error";

export interface UseTerminalOptions {
  serviceId: string;
  autoConnect?: boolean;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  onData?: (data: string) => void;
  onStatusChange?: (status: TerminalStatus) => void;
}

export interface UseTerminalReturn {
  status: TerminalStatus;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  sendInput: (data: string | Uint8Array) => void;
  sendSignal: (signal: "INT" | "TERM" | "KILL") => void;
}

/**
 * WebSocket 终端连接 Hook
 * 
 * 协议：
 * - Binary 消息：双向传输原始终端数据
 * - Text 消息（发送）：JSON 控制命令 {"signal": "INT|TERM|KILL"}
 * - Text 消息（接收）：JSON 通知 {"type": "notice|error", "message": "..."}
 */
export function useTerminal({
  serviceId,
  autoConnect = false,
  autoReconnect = true,
  reconnectInterval = 2000,
  onData,
  onStatusChange,
}: UseTerminalOptions): UseTerminalReturn {
  const [status, setStatus] = useState<TerminalStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectRef = useRef<(() => void) | null>(null);
  const shouldReconnectRef = useRef(true); // 控制是否应该重连

  // 更新状态并通知外部
  const updateStatus = useCallback(
    (newStatus: TerminalStatus) => {
      setStatus(newStatus);
      onStatusChange?.(newStatus);
    },
    [onStatusChange]
  );

  // 构建 WebSocket URL
  const buildWsUrl = useCallback(() => {
    const baseUrl = api.getBaseUrl();
    const wsBase = baseUrl.replace("https://", "wss://").replace("http://", "ws://");
    return `${wsBase}/services/${serviceId}/attach`;
  }, [serviceId]);

  // 连接 WebSocket
  const connect = useCallback(() => {
    // 清理旧连接
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    shouldReconnectRef.current = true; // 重置重连标志
    setError(null);
    updateStatus("connecting");

    const wsUrl = buildWsUrl();
    const token = api.getAccessToken();

    // 创建 WebSocket 连接
    // 注意：浏览器 WebSocket 不支持自定义 headers，需要通过 URL 参数传递 token
    // 或者后端支持从 cookie 读取认证信息
    const urlWithAuth = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
    
    try {
      const ws = new WebSocket(urlWithAuth);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        updateStatus("connected");
        setError(null);
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          // 二进制数据 - 终端输出
          const text = new TextDecoder().decode(event.data);
          onData?.(text);
        } else if (typeof event.data === "string") {
          // 文本消息 - JSON 控制消息
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "notice") {
              // 可选：显示通知
              console.log("[Terminal Notice]", msg.message);
            } else if (msg.type === "error") {
              console.error("[Terminal Error]", msg.message);
              setError(msg.message);
            }
          } catch {
            // 非 JSON 文本，直接输出
            onData?.(event.data);
          }
        }
      };

      ws.onerror = () => {
        // WebSocket error 事件不包含有用信息，具体错误在 onclose 中处理
        console.error("[Terminal] WebSocket connection failed");
      };

      ws.onclose = (event) => {
        wsRef.current = null;
        if (event.wasClean) {
          updateStatus("disconnected");
        } else {
          // 根据错误码给出更有用的信息
          let errorMsg = "连接失败";
          switch (event.code) {
            case 1006:
              errorMsg = "服务不在运行";
              break;
            case 1008:
              errorMsg = "认证失败，请重新登录";
              break;
            case 1011:
              errorMsg = "服务内部错误";
              break;
            default:
              errorMsg = `连接断开 (code: ${event.code})`;
          }
          setError(errorMsg);
          updateStatus("error");
          
          // 自动重连
          if (autoReconnect && shouldReconnectRef.current) {
            reconnectTimeoutRef.current = setTimeout(() => {
              if (shouldReconnectRef.current && connectRef.current) {
                connectRef.current();
              }
            }, reconnectInterval);
          }
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("[Terminal] Failed to create WebSocket:", err);
      setError("无法创建连接");
      updateStatus("error");
    }
  }, [buildWsUrl, onData, updateStatus, autoReconnect, reconnectInterval]);

  // 断开连接
  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false; // 手动断开不要重连
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000, "User disconnect");
      wsRef.current = null;
    }
    updateStatus("disconnected");
  }, [updateStatus]);

  // 发送输入数据
  const sendInput = useCallback((data: string | Uint8Array) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      if (typeof data === "string") {
        wsRef.current.send(new TextEncoder().encode(data));
      } else {
        wsRef.current.send(data);
      }
    }
  }, []);

  // 发送信号
  const sendSignal = useCallback((signal: "INT" | "TERM" | "KILL") => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ signal }));
    }
  }, []);

  // 保存 connect 函数引用（用于 autoConnect）
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // 自动连接
  useEffect(() => {
    if (autoConnect && connectRef.current) {
      // 延迟一点确保终端已初始化
      const timer = setTimeout(() => {
        connectRef.current?.();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [autoConnect]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmount");
      }
    };
  }, []);

  return {
    status,
    error,
    connect,
    disconnect,
    sendInput,
    sendSignal,
  };
}
