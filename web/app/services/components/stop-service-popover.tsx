"use client";

import { useState } from "react";
import {
  RiStopCircleLine,
  RiCloseCircleLine,
} from "@remixicon/react";
import * as Popover from "@/components/ui/popover";

interface StopServicePopoverProps {
  children: React.ReactNode;
  onShutdown: () => void | Promise<void>;
  onKill: () => void | Promise<void>;
  align?: "start" | "center" | "end";
}

export function StopServicePopover({
  children,
  onShutdown,
  onKill,
  align = "center",
}: StopServicePopoverProps) {
  const [open, setOpen] = useState(false);

  const handleAction = async (action: () => void | Promise<void>) => {
    setOpen(false);
    await action();
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Content align={align} className="w-32 p-1" showArrow={false}>
        <button
          type="button"
          onClick={() => handleAction(onShutdown)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-text-sub-600 transition-colors hover:bg-bg-weak-50 hover:text-text-strong-950"
        >
          <RiStopCircleLine className="size-4" />
          <span>关闭</span>
        </button>
        <button
          type="button"
          onClick={() => handleAction(onKill)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-error-base transition-colors hover:bg-error-lighter"
        >
          <RiCloseCircleLine className="size-4" />
          <span>终止</span>
        </button>
      </Popover.Content>
    </Popover.Root>
  );
}
