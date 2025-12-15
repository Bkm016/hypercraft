// AlignUI Notification v0.0.0

import * as React from 'react';
import { cn } from '@/utils/cn';
import * as NotificationPrimitives from '@radix-ui/react-toast';
import {
  RiAlertFill,
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiInformationFill,
  RiMagicFill,
} from '@remixicon/react';

const NotificationProvider = NotificationPrimitives.Provider;
const NotificationAction = NotificationPrimitives.Action;

const NotificationViewport = React.forwardRef<
  React.ComponentRef<typeof NotificationPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof NotificationPrimitives.Viewport>
>(({ className, ...rest }, forwardedRef) => (
  <NotificationPrimitives.Viewport
    ref={forwardedRef}
    className={cn(
      // 统一使用底部居中的 Sonner 风格
      'fixed bottom-0 left-1/2 -translate-x-1/2 z-[100] flex max-h-screen w-full flex-col items-center gap-3 p-4',
      className,
    )}
    {...rest}
  />
));
NotificationViewport.displayName = 'NotificationViewport';

type NotificationProps = React.ComponentPropsWithoutRef<
  typeof NotificationPrimitives.Root
> & {
  status?: 'success' | 'warning' | 'error' | 'information' | 'feature';
  title?: string;
};

// Sonner 风格的图标颜色
const statusColors = {
  success: 'text-success-base',
  warning: 'text-warning-base',
  error: 'text-error-base',
  information: 'text-information-base',
  feature: 'text-feature-base',
} as const;

const Notification = React.forwardRef<
  React.ComponentRef<typeof NotificationPrimitives.Root>,
  NotificationProps
>(
  (
    {
      className,
      status,
      title,
      ...rest
    }: NotificationProps,
    forwardedRef,
  ) => {
    let Icon: React.ElementType;

    switch (status) {
      case 'success':
        Icon = RiCheckboxCircleFill;
        break;
      case 'warning':
        Icon = RiAlertFill;
        break;
      case 'error':
        Icon = RiErrorWarningFill;
        break;
      case 'information':
        Icon = RiInformationFill;
        break;
      case 'feature':
        Icon = RiMagicFill;
        break;
      default:
        Icon = RiErrorWarningFill;
        break;
    }

    return (
      <NotificationPrimitives.Root
        ref={forwardedRef}
        className={cn(
          // 统一使用底部滑入动画
          'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4 data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom-4 data-[state=closed]:fade-out-0',
          'duration-200',
          className,
        )}
        asChild
        {...rest}
      >
        {/* 统一使用 Sonner 风格简洁 toast */}
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-lg">
          <Icon className={cn('size-4 shrink-0', status && statusColors[status])} aria-hidden='true' />
          {title && (
            <span className='text-sm font-medium'>{title}</span>
          )}
        </div>
      </NotificationPrimitives.Root>
    );
  },
);
Notification.displayName = 'Notification';

export {
  Notification as Root,
  NotificationProvider as Provider,
  NotificationAction as Action,
  NotificationViewport as Viewport,
  type NotificationProps,
};
