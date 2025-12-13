"use client";

import { RiAddLine, RiDeleteBinLine, RiInformationLine } from "@remixicon/react";
import * as Button from "@/components/ui/button";
import * as CompactButton from "@/components/ui/compact-button";
import * as FormDialog from "@/components/ui/form-dialog";
import type { EnvVar } from "./types";

interface EnvVarsFieldsProps {
  envVars: EnvVar[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: "key" | "value", value: string) => void;
}

export function EnvVarsFields({ envVars, onAdd, onRemove, onUpdate }: EnvVarsFieldsProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wider text-text-soft-400">
          环境变量
        </h4>
        <Button.Root
          type="button"
          variant="neutral"
          mode="ghost"
          size="xxsmall"
          onClick={onAdd}
        >
          <Button.Icon as={RiAddLine} />
          添加
        </Button.Root>
      </div>

      {envVars.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-stroke-soft-200 bg-bg-weak-50/50 p-3">
          {envVars.map((env, index) => (
            <div key={index} className="flex items-center gap-2">
              <FormDialog.Input
                placeholder="KEY"
                value={env.key}
                onChange={(e) => onUpdate(index, "key", e.target.value)}
                className="w-28 font-mono text-xs"
              />
              <span className="text-text-soft-400 font-mono">=</span>
              <FormDialog.Input
                placeholder="value"
                value={env.value}
                onChange={(e) => onUpdate(index, "value", e.target.value)}
                className="flex-1 font-mono text-xs"
              />
              <CompactButton.Root
                type="button"
                variant="ghost"
                onClick={() => onRemove(index)}
                className="hover:bg-error-lighter hover:text-error-base"
              >
                <CompactButton.Icon as={RiDeleteBinLine} />
              </CompactButton.Root>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-stroke-soft-200 py-8 text-center">
          <RiInformationLine className="mx-auto size-5 text-text-soft-400" />
          <p className="mt-2 text-xs text-text-soft-400">
            点击上方"添加"按钮添加环境变量
          </p>
        </div>
      )}
    </div>
  );
}
