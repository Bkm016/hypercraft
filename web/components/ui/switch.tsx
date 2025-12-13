import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { cn } from '@/utils/cn';

const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, disabled, ...rest }, forwardedRef) => {
  return (
    <SwitchPrimitives.Root
      className={cn(
        'relative inline-flex h-[26px] w-[46px] shrink-0 cursor-pointer rounded-full p-[3px]',
        'transition-colors duration-200 ease-out',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-stroke-strong-950/20 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=unchecked]:bg-stroke-sub-300',
        'data-[state=checked]:bg-text-strong-950',
        className,
      )}
      ref={forwardedRef}
      disabled={disabled}
      {...rest}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          'block size-5 rounded-full',
          'bg-bg-white-0 shadow-[0_1px_2px_rgba(0,0,0,0.15)]',
          'transition-transform duration-200 ease-out',
          'data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
        )}
      />
    </SwitchPrimitives.Root>
  );
});
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch as Root };
