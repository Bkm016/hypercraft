"use client";

import { useRef, useState } from "react";
import { RiCheckLine, RiFileCopyLine, RiKey2Line } from "@remixicon/react";
import * as FormDialog from "@/components/ui/form-dialog";
import { notification } from "@/hooks/use-notification";
import { copyText } from "./copy-text";

export interface SecretRevealModalProps {
  secret: string;
  name: string;
  onClose: () => void;
}

export function SecretRevealModal({ secret, name, onClose }: SecretRevealModalProps) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const handleCopy = async () => {
    const ok = await copyText(secret);
    if (ok) {
      setCopied(true);
      notification({ status: "success", title: "已复制完整密钥" });
      setTimeout(() => setCopied(false), 2000);
    } else {
      const el = preRef.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      notification({ status: "error", title: "自动复制失败，请手动复制选中文本" });
    }
  };

  return (
    <FormDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <FormDialog.Content>
        <div>
          <FormDialog.Header
            icon={RiKey2Line}
            title="API Key"
            description={`「${name}」— 可随时在编辑页再次查看或复制`}
          />
          <FormDialog.Body className="space-y-4">
            <button
              type="button"
              onClick={handleCopy}
              className="block w-full rounded-lg border border-stroke-soft-200 bg-bg-weak-50 p-0 text-left transition hover:border-stroke-sub-300"
              title="点击复制"
            >
              <pre
                ref={preRef}
                className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-text-strong-950 break-all whitespace-pre-wrap select-all"
              >
                {secret}
              </pre>
            </button>
          </FormDialog.Body>
          <FormDialog.Footer>
            <FormDialog.Button type="button" variant="secondary" onClick={onClose}>
              关闭
            </FormDialog.Button>
            <FormDialog.Button
              type="button"
              onClick={handleCopy}
              icon={copied ? RiCheckLine : RiFileCopyLine}
            >
              {copied ? "已复制" : "复制密钥"}
            </FormDialog.Button>
          </FormDialog.Footer>
        </div>
      </FormDialog.Content>
    </FormDialog.Root>
  );
}
