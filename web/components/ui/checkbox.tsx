// AlignUI Checkbox — 精简样式，深浅色选中态对比清晰

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { RiCheckLine, RiSubtractLine } from '@remixicon/react';
import { cn } from '@/utils/cn';

const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...rest }, forwardedRef) => {
  return (
    <CheckboxPrimitive.Root
      ref={forwardedRef}
      className={cn(
        'group/checkbox relative inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] border border-stroke-sub-300 bg-bg-white-0',
        'dark:border-stroke-soft-200 dark:bg-white/[0.08]',
        'transition-[color,background-color,border-color,transform] duration-150 ease-out',
        'hover:border-text-strong-950/35 dark:hover:border-stroke-sub-300',
        'active:scale-[0.92]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-bg-white-0',
        'disabled:pointer-events-none disabled:opacity-40',
        'data-[state=checked]:border-transparent data-[state=checked]:bg-checkbox-fill data-[state=checked]:text-checkbox-mark',
        'data-[state=indeterminate]:border-transparent data-[state=indeterminate]:bg-checkbox-fill data-[state=indeterminate]:text-checkbox-mark',
        className,
      )}
      {...rest}
    >
      <CheckboxPrimitive.Indicator
        className={cn(
          'flex items-center justify-center text-current',
          'animate-in zoom-in-95 fade-in duration-150 ease-out',
        )}
      >
        <RiCheckLine
          className="size-3.5 group-data-[state=indeterminate]/checkbox:hidden"
          aria-hidden
        />
        <RiSubtractLine
          className="hidden size-3 group-data-[state=indeterminate]/checkbox:block"
          aria-hidden
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox as Root };