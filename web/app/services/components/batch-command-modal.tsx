"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  RiCommandLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
} from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import { api } from "@/lib/api";

interface ServiceResult {
  id: string;
  name: string;
  status: "pending" | "sending" | "success" | "error";
  error?: string;
}

interface BatchCommandModalProps {
  open: boolean;
  onClose: () => void;
  serviceIds: string[];
  serviceNames: Map<string, string>;
}

// 发送单个指令到服务
async function sendCommandToService(
  serviceId: string,
  command: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const baseUrl = api.getBaseUrl();
    const wsBase = baseUrl.replace("https://", "wss://").replace("http://", "ws://");
    const token = api.getAccessToken();
    const wsUrl = token
      ? `${wsBase}/services/${serviceId}/attach?token=${encodeURIComponent(token)}`
      : `${wsBase}/services/${serviceId}/attach`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    let sent = false;

    const timeout = setTimeout(() => {
      if (!sent) {
        ws.close();
        reject(new Error("连接超时"));
      }
    }, 5000);

    ws.onopen = () => {
      const data = new TextEncoder().encode(command + "\n");
      ws.send(data);
      sent = true;
      clearTimeout(timeout);
      setTimeout(() => {
        ws.close(1000, "Command sent");
        resolve();
      }, 100);
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("连接失败"));
    };

    ws.onclose = (event) => {
      clearTimeout(timeout);
      if (!sent) {
        if (event.code === 1006) {
          reject(new Error("服务未运行"));
        } else {
          reject(new Error(`连接断开 (${event.code})`));
        }
      }
    };
  });
}

export function BatchCommandModal({
  open,
  onClose,
  serviceIds,
  serviceNames,
}: BatchCommandModalProps) {
  const [command, setCommand] = useState("");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<ServiceResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    if (sending) return;
    setCommand("");
    setResults([]);
    setShowResults(false);
    onClose();
  }, [sending, onClose]);

  const handleSend = useCallback(async () => {
    if (!command.trim() || sending) return;

    setSending(true);
    setShowResults(true);

    const initialResults: ServiceResult[] = serviceIds.map((id) => ({
      id,
      name: serviceNames.get(id) || id,
      status: "pending",
    }));
    setResults(initialResults);

    const promises = serviceIds.map(async (id, index) => {
      setResults((prev) =>
        prev.map((r, i) => (i === index ? { ...r, status: "sending" as const } : r))
      );

      try {
        await sendCommandToService(id, command.trim());
        setResults((prev) =>
          prev.map((r, i) => (i === index ? { ...r, status: "success" as const } : r))
        );
      } catch (err) {
        const error = err instanceof Error ? err.message : "发送失败";
        setResults((prev) =>
          prev.map((r, i) => (i === index ? { ...r, status: "error" as const, error } : r))
        );
      }
    });

    await Promise.all(promises);
    setSending(false);
  }, [command, sending, serviceIds, serviceNames]);

  const successCount = results.filter((r) => r.status === "success").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  return (
    <FormDialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <FormDialog.Content>
        <div>
          <FormDialog.Header
            icon={RiCommandLine}
            title="批量发送指令"
            description={`向 ${serviceIds.length} 个服务发送相同指令`}
          />

          <FormDialog.Body className="space-y-4">
            {/* 指令输入 */}
            <FormDialog.Field label="指令内容" required hint="指令将发送到所有选中的运行中服务">
              <FormDialog.Input
                ref={inputRef}
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && command.trim() && !sending) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="输入要发送的指令..."
                disabled={sending}
                className="font-mono"
              />
            </FormDialog.Field>

            {/* 发送结果 */}
            {showResults && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-text-strong-950">发送结果</span>
                  {!sending && (
                    <span className="text-text-sub-600">
                      {successCount} 成功
                      {errorCount > 0 && (
                        <span className="ml-2 text-error-base">{errorCount} 失败</span>
                      )}
                    </span>
                  )}
                </div>
                <div className="max-h-48 overflow-y-auto rounded-xl border border-stroke-soft-200">
                  {results.map((result) => (
                    <div
                      key={result.id}
                      className="flex items-center gap-2 border-b border-stroke-soft-200 px-3 py-2.5 last:border-b-0"
                    >
                      {result.status === "pending" && (
                        <span className="size-4 rounded-full bg-text-disabled-300" />
                      )}
                      {result.status === "sending" && (
                        <RiLoader4Line className="size-4 animate-spin text-primary-base" />
                      )}
                      {result.status === "success" && (
                        <RiCheckLine className="size-4 text-success-base" />
                      )}
                      {result.status === "error" && (
                        <RiErrorWarningLine className="size-4 text-error-base" />
                      )}
                      <span className="flex-1 truncate text-sm text-text-strong-950">
                        {result.name}
                      </span>
                      {result.error && (
                        <span className="text-xs text-error-base">{result.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </FormDialog.Body>

          <FormDialog.Footer>
            <FormDialog.Button variant="secondary" onClick={handleClose} disabled={sending}>
              {showResults && !sending ? "关闭" : "取消"}
            </FormDialog.Button>
            {(!showResults || sending) && (
              <FormDialog.Button onClick={handleSend} disabled={!command.trim() || sending} loading={sending}>
                发送指令
              </FormDialog.Button>
            )}
            {showResults && !sending && (
              <FormDialog.Button
                onClick={() => {
                  setShowResults(false);
                  setResults([]);
                }}
              >
                再次发送
              </FormDialog.Button>
            )}
          </FormDialog.Footer>
        </div>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
