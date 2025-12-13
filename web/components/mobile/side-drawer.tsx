// 移动端左侧滑出抽屉组件

"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { RiCloseLine } from "@remixicon/react";

import * as CompactButton from "@/components/ui/compact-button";
import { cn } from "@/utils/cn";

const SideDrawerRoot = DialogPrimitive.Root;
SideDrawerRoot.displayName = "SideDrawer";

const SideDrawerTrigger = DialogPrimitive.Trigger;
SideDrawerTrigger.displayName = "SideDrawerTrigger";

const SideDrawerClose = DialogPrimitive.Close;
SideDrawerClose.displayName = "SideDrawerClose";

const SideDrawerPortal = DialogPrimitive.Portal;
SideDrawerPortal.displayName = "SideDrawerPortal";

const SideDrawerOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...rest }, forwardedRef) => {
  return (
    <DialogPrimitive.Overlay
      ref={forwardedRef}
      className={cn(
        // base
        "fixed inset-0 z-50 bg-overlay backdrop-blur-[10px]",
        // animation
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className
      )}
      {...rest}
    />
  );
});
SideDrawerOverlay.displayName = "SideDrawerOverlay";

const SideDrawerContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...rest }, forwardedRef) => {
  return (
    <SideDrawerPortal>
      <SideDrawerOverlay />
      <DialogPrimitive.Content
        ref={forwardedRef}
        className={cn(
          // base
          "fixed inset-y-0 left-0 z-50 h-full w-[280px] max-w-[80vw] overflow-y-auto",
          "border-r border-stroke-soft-200 bg-bg-white-0",
          // animation
          "data-[state=open]:duration-300 data-[state=open]:ease-out data-[state=open]:animate-in",
          "data-[state=closed]:duration-200 data-[state=closed]:ease-in data-[state=closed]:animate-out",
          "data-[state=open]:slide-in-from-left-full",
          "data-[state=closed]:slide-out-to-left-full",
          className
        )}
        {...rest}
      >
        <div className="relative flex size-full flex-col">{children}</div>
      </DialogPrimitive.Content>
    </SideDrawerPortal>
  );
});
SideDrawerContent.displayName = "SideDrawerContent";

function SideDrawerHeader({
  className,
  children,
  showCloseButton = true,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-stroke-soft-200 p-4",
        className
      )}
      {...rest}
    >
      {children}

      {showCloseButton && (
        <SideDrawerClose asChild>
          <CompactButton.Root variant="ghost" size="large">
            <CompactButton.Icon as={RiCloseLine} />
          </CompactButton.Root>
        </SideDrawerClose>
      )}
    </div>
  );
}
SideDrawerHeader.displayName = "SideDrawerHeader";

const SideDrawerTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...rest }, forwardedRef) => {
  return (
    <DialogPrimitive.Title
      ref={forwardedRef}
      className={cn("flex-1 text-label-lg text-text-strong-950", className)}
      {...rest}
    />
  );
});
SideDrawerTitle.displayName = "SideDrawerTitle";

function SideDrawerBody({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex-1 overflow-y-auto", className)} {...rest}>
      {children}
    </div>
  );
}
SideDrawerBody.displayName = "SideDrawerBody";

function SideDrawerFooter({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 border-t border-stroke-soft-200 p-4",
        className
      )}
      {...rest}
    />
  );
}
SideDrawerFooter.displayName = "SideDrawerFooter";

export {
  SideDrawerRoot as Root,
  SideDrawerTrigger as Trigger,
  SideDrawerClose as Close,
  SideDrawerContent as Content,
  SideDrawerHeader as Header,
  SideDrawerTitle as Title,
  SideDrawerBody as Body,
  SideDrawerFooter as Footer,
};
