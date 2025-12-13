// FormDialog - 统一的表单弹窗组件
// 支持多种尺寸、自定义动画、统一的表单布局

"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { RiCloseLine, RiLoader4Line } from "@remixicon/react";
import type { RemixiconComponentType } from "@remixicon/react";
import { cn } from "@/utils/cn";

// ============================================================================
// Context
// ============================================================================

interface FormDialogContextValue {
  size: "sm" | "md" | "lg" | "xl";
}

const FormDialogContext = React.createContext<FormDialogContextValue>({
  size: "md",
});

// ============================================================================
// Root
// ============================================================================

interface FormDialogRootProps extends DialogPrimitive.DialogProps {
  size?: "sm" | "md" | "lg" | "xl";
}

function FormDialogRoot({ size = "md", children, ...props }: FormDialogRootProps) {
  return (
    <FormDialogContext.Provider value={{ size }}>
      <DialogPrimitive.Root {...props}>{children}</DialogPrimitive.Root>
    </FormDialogContext.Provider>
  );
}

// ============================================================================
// Overlay
// ============================================================================

const FormDialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // base
      "fixed inset-0 z-50 bg-static-black/50 backdrop-blur-[6px]",
      // animation
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      "data-[state=open]:duration-300 data-[state=closed]:duration-200",
      "data-[state=open]:ease-out data-[state=closed]:ease-in",
      className
    )}
    {...props}
  />
));
FormDialogOverlay.displayName = "FormDialogOverlay";

// ============================================================================
// Content
// ============================================================================

const sizeClasses = {
  sm: "md:max-w-sm",
  md: "md:max-w-md",
  lg: "md:max-w-lg",
  xl: "md:max-w-xl",
};

const FormDialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const { size } = React.useContext(FormDialogContext);

  return (
    <DialogPrimitive.Portal>
      <FormDialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          // base
          "fixed z-50 flex flex-col bg-bg-white-0",
          // mobile: fullscreen
          "inset-0 w-full max-w-none rounded-none border-0",
          // desktop: centered modal
          "md:inset-auto md:left-[50%] md:top-[50%] md:translate-x-[-50%] md:translate-y-[-50%]",
          "md:rounded-2xl md:border md:border-stroke-soft-200",
          "md:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.25),0_0_0_1px_rgba(0,0,0,0.05)]",
          "md:dark:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.05)]",
          // desktop size
          sizeClasses[size],
          // animation
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          // mobile animation: slide from bottom
          "data-[state=closed]:slide-out-to-bottom-full data-[state=open]:slide-in-from-bottom-full",
          // desktop animation: zoom
          "md:data-[state=closed]:slide-out-to-bottom-2 md:data-[state=open]:slide-in-from-bottom-2",
          "md:data-[state=closed]:zoom-out-[0.98] md:data-[state=open]:zoom-in-[0.98]",
          "data-[state=open]:duration-200 data-[state=closed]:duration-150",
          // focus
          "focus:outline-none",
          // 让直接子元素（form 或 div）自动应用 flex 布局
          "*:flex *:flex-1 *:flex-col *:overflow-hidden",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
FormDialogContent.displayName = "FormDialogContent";

// ============================================================================
// Header
// ============================================================================

interface FormDialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: RemixiconComponentType;
  iconClassName?: string;
  title: string;
  description?: string;
  showClose?: boolean;
}

function FormDialogHeader({
  className,
  icon: Icon,
  iconClassName,
  title,
  description,
  showClose = true,
  ...props
}: FormDialogHeaderProps) {
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-start gap-3 border-b border-stroke-soft-200 px-4 py-4 md:gap-4 md:px-6 md:py-6",
        className
      )}
      {...props}
    >
      {Icon && (
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl md:size-12",
            "bg-linear-to-b from-bg-white-0 to-bg-weak-50",
            "ring-1 ring-inset ring-stroke-soft-200",
            "shadow-sm"
          )}
        >
          <Icon className={cn("size-4 text-text-sub-600 md:size-5", iconClassName)} />
        </div>
      )}
      <div className="flex-1 pt-0.5 pr-8">
        <DialogPrimitive.Title className="text-base font-semibold tracking-tight text-text-strong-950 md:text-lg">
          {title}
        </DialogPrimitive.Title>
        {description && (
          <DialogPrimitive.Description className="text-xs text-text-soft-400 md:text-sm">
            {description}
          </DialogPrimitive.Description>
        )}
      </div>
      {showClose && (
        <DialogPrimitive.Close
          className={cn(
            "absolute right-3 top-3 md:right-5 md:top-5",
            "flex size-9 items-center justify-center rounded-xl",
            "text-text-soft-400 transition-all duration-200",
            "hover:bg-bg-weak-50 hover:text-text-strong-950",
            "focus:outline-none focus:ring-2 focus:ring-primary-alpha-10",
            "active:scale-90"
          )}
        >
          <RiCloseLine className="size-5" />
          <span className="sr-only">关闭</span>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

// ============================================================================
// Body
// ============================================================================

interface FormDialogBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  noPadding?: boolean;
}

function FormDialogBody({ className, noPadding, ...props }: FormDialogBodyProps) {
  return (
    <div
      className={cn(
        // mobile: fill remaining space
        "flex-1 overflow-y-auto",
        // desktop: max height
        "md:flex-none md:max-h-[60vh]",
        "scrollbar-thin scrollbar-track-transparent scrollbar-thumb-stroke-soft-200",
        !noPadding && "px-4 py-4 md:px-6 md:py-6",
        className
      )}
      {...props}
    />
  );
}

// ============================================================================
// Footer
// ============================================================================

function FormDialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-3 border-t border-stroke-soft-200 bg-bg-weak-50/50 px-6 py-4",
        className
      )}
      {...props}
    />
  );
}

// ============================================================================
// Form Field
// ============================================================================

interface FormDialogFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
}

function FormDialogField({
  className,
  label,
  required,
  hint,
  error,
  children,
  ...props
}: FormDialogFieldProps) {
  return (
    <div className={cn("space-y-2", className)} {...props}>
      <div className="flex items-baseline justify-between gap-2">
        <label className="flex items-center gap-1.5 text-sm font-medium text-text-strong-950">
          {label}
          {required && <span className="text-xs text-error-base">*</span>}
        </label>
        {hint && !error && (
          <span className="text-xs text-text-soft-400">{hint}</span>
        )}
      </div>
      {children}
      {error && (
        <p className="text-xs text-error-base">{error}</p>
      )}
    </div>
  );
}

// ============================================================================
// Error Alert
// ============================================================================

interface FormDialogErrorProps {
  message: string;
  className?: string;
}

function FormDialogError({ message, className }: FormDialogErrorProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl bg-error-lighter px-4 py-3",
        className
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-error-base/10">
        <svg
          className="size-4 text-error-base"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <p className="flex-1 text-paragraph-sm text-error-base">{message}</p>
    </div>
  );
}

// ============================================================================
// Action Button
// ============================================================================

interface FormDialogButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
  icon?: RemixiconComponentType;
}

const FormDialogButton = React.forwardRef<
  HTMLButtonElement,
  FormDialogButtonProps
>(
  (
    {
      className,
      variant = "primary",
      loading,
      disabled,
      icon: Icon,
      children,
      ...props
    },
    ref
  ) => {
    const variantClasses = {
      primary: cn(
        // 使用固定的深色背景，确保 dark mode 下也能看到白色文字
        "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900",
        "hover:bg-neutral-800 dark:hover:bg-neutral-100",
        "focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 dark:focus-visible:ring-white",
        "active:scale-[0.98]"
      ),
      secondary: cn(
        "bg-bg-white-0 text-text-sub-600",
        "ring-1 ring-inset ring-stroke-soft-200",
        "hover:bg-bg-weak-50 hover:text-text-strong-950 hover:ring-stroke-sub-300",
        "focus-visible:ring-2 focus-visible:ring-stroke-strong-950 focus-visible:ring-offset-2",
        "active:scale-[0.98]"
      ),
      danger: cn(
        "bg-error-base text-white",
        "hover:opacity-90",
        "focus-visible:ring-2 focus-visible:ring-error-base focus-visible:ring-offset-2",
        "active:scale-[0.98]"
      ),
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          // base
          "relative inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4",
          "text-label-sm font-medium",
          "transition-all duration-150 ease-out",
          // disabled
          "disabled:pointer-events-none disabled:opacity-50",
          // variant
          variantClasses[variant],
          className
        )}
        {...props}
      >
        {loading ? (
          <RiLoader4Line className="size-4 animate-spin" />
        ) : Icon ? (
          <Icon className="size-4" />
        ) : null}
        {children}
      </button>
    );
  }
);
FormDialogButton.displayName = "FormDialogButton";

// ============================================================================
// Form Input
// ============================================================================

interface FormDialogInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
  leftIcon?: RemixiconComponentType;
}

const FormDialogInput = React.forwardRef<HTMLInputElement, FormDialogInputProps>(
  ({ className, hasError, leftIcon: LeftIcon, ...props }, ref) => {
    return (
      <div className="relative">
        {LeftIcon && (
          <LeftIcon className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-text-soft-400" />
        )}
        <input
          ref={ref}
          className={cn(
            // base
            "h-10 w-full rounded-xl bg-bg-white-0 text-paragraph-sm text-text-strong-950",
            "ring-1 ring-inset ring-stroke-soft-200",
            "transition-all duration-150 ease-out",
            // placeholder
            "placeholder:text-text-soft-400",
            // hover
            "hover:ring-stroke-sub-300",
            // focus
            "focus:outline-none focus:ring-2 focus:ring-text-strong-950",
            // error
            hasError && "ring-error-base focus:ring-error-base",
            // disabled
            "disabled:bg-bg-weak-50 disabled:text-text-disabled-300",
            // padding
            LeftIcon ? "pl-10 pr-3" : "px-3",
            className
          )}
          {...props}
        />
      </div>
    );
  }
);
FormDialogInput.displayName = "FormDialogInput";

// ============================================================================
// Form Textarea
// ============================================================================

interface FormDialogTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean;
}

const FormDialogTextarea = React.forwardRef<
  HTMLTextAreaElement,
  FormDialogTextareaProps
>(({ className, hasError, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        // base
        "min-h-[100px] w-full resize-none rounded-xl bg-bg-white-0 px-3 py-2.5",
        "text-paragraph-sm text-text-strong-950",
        "ring-1 ring-inset ring-stroke-soft-200",
        "transition-all duration-150 ease-out",
        // placeholder
        "placeholder:text-text-soft-400",
        // hover
        "hover:ring-stroke-sub-300",
        // focus
        "focus:outline-none focus:ring-2 focus:ring-text-strong-950",
        // error
        hasError && "ring-error-base focus:ring-error-base",
        // disabled
        "disabled:bg-bg-weak-50 disabled:text-text-disabled-300",
        className
      )}
      {...props}
    />
  );
});
FormDialogTextarea.displayName = "FormDialogTextarea";

import * as Switch from "@/components/ui/switch";

// ============================================================================
// Form Switch
// ============================================================================

interface FormDialogSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

function FormDialogSwitch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
}: FormDialogSwitchProps) {
  const id = React.useId();

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl px-4 py-4",
        "border border-stroke-soft-200 bg-bg-weak-50/50",
        "transition-all duration-200",
        !disabled && "hover:border-stroke-sub-300 hover:bg-bg-weak-50",
        className
      )}
    >
      <div className="space-y-1">
        <label
          htmlFor={id}
          className="cursor-pointer text-sm font-medium text-text-strong-950"
        >
          {label}
        </label>
        {description && (
          <p className="text-xs text-text-soft-400 leading-relaxed">{description}</p>
        )}
      </div>
      <Switch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export {
  FormDialogRoot as Root,
  FormDialogContent as Content,
  FormDialogHeader as Header,
  FormDialogBody as Body,
  FormDialogFooter as Footer,
  FormDialogField as Field,
  FormDialogError as Error,
  FormDialogButton as Button,
  FormDialogInput as Input,
  FormDialogTextarea as Textarea,
  FormDialogSwitch as Switch,
};
