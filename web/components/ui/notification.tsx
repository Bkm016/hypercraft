// AlignUI Notification v0.0.0

import * as React from 'react';
import * as Alert from '@/components/ui/alert';
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
      // 移动端：底部居中
      'fixed bottom-0 left-1/2 -translate-x-1/2 z-[100] flex max-h-screen w-full flex-col items-center gap-3 p-4',
      // 桌面端：右上角
      'sm:top-0 sm:right-0 sm:bottom-auto sm:left-auto sm:translate-x-0 sm:items-end sm:max-w-[438px] sm:gap-5 sm:p-6',
      className,
    )}
    {...rest}
  />
));
NotificationViewport.displayName = 'NotificationViewport';

type NotificationProps = React.ComponentPropsWithoutRef<
  typeof NotificationPrimitives.Root
> &
  Pick<
    React.ComponentPropsWithoutRef<typeof Alert.Root>,
    'status' | 'variant'
  > & {
    title?: string;
    description?: React.ReactNode;
    action?: React.ReactNode;
    disableDismiss?: boolean;
  };

// 移动端 Sonner 风格的图标颜色
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
      variant = 'filled',
      title,
      description,
      action,
      disableDismiss = false,
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
          // 移动端动画
          'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4 data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom-4 data-[state=closed]:fade-out-0',
          // 桌面端动画
          'sm:data-[state=open]:slide-in-from-right-full sm:data-[state=open]:slide-in-from-bottom-0',
          'sm:data-[state=closed]:slide-out-to-right-full sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=closed]:fade-out-80',
          // swipe (桌面端)
          'sm:data-[swipe=cancel]:translate-x-0 sm:data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] sm:data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] sm:data-[swipe=move]:transition-none sm:data-[swipe=end]:animate-out',
          'duration-200',
          className,
        )}
        asChild
        {...rest}
      >
        <div>
          {/* 移动端：Sonner 风格简洁 toast */}
          <div className="sm:hidden flex items-center gap-2.5 px-4 py-3 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-lg">
            <Icon className={cn('size-4 shrink-0', status && statusColors[status])} aria-hidden='true' />
            {title && (
              <span className='text-sm font-medium'>{title}</span>
            )}
          </div>

          {/* 桌面端：原有 Alert 风格 */}
          <Alert.Root variant={variant} status={status} size='large' className="hidden sm:flex">
            <Alert.Icon as={Icon} aria-hidden='true' />
            <div className='flex w-full flex-col gap-2.5'>
              <div className='flex w-full flex-col gap-1'>
                {title && (
                  <NotificationPrimitives.Title className='text-label-sm'>
                    {title}
                  </NotificationPrimitives.Title>
                )}
                {description && (
                  <NotificationPrimitives.Description>
                    {description}
                  </NotificationPrimitives.Description>
                )}
              </div>
              {action && <div className='flex items-center gap-2'>{action}</div>}
            </div>
            {!disableDismiss && (
              <NotificationPrimitives.Close aria-label='Close'>
                <Alert.CloseIcon />
              </NotificationPrimitives.Close>
            )}
          </Alert.Root>
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
