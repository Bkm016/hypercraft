'use client';

import * as React from 'react';
import type { NotificationProps } from '@/components/ui/notification';

const NOTIFICATION_LIMIT = 1;
const NOTIFICATION_REMOVE_DELAY = 1000000;
const DEFAULT_DURATION = 3000; // 默认 3 秒自动消失

type NotificationPropsWithId = NotificationProps & {
  id: string;
};

const actionTypes = {
  ADD_NOTIFICATION: 'ADD_NOTIFICATION',
  UPDATE_NOTIFICATION: 'UPDATE_NOTIFICATION',
  DISMISS_NOTIFICATION: 'DISMISS_NOTIFICATION',
  REMOVE_NOTIFICATION: 'REMOVE_NOTIFICATION',
} as const;

let count = 0;

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

type ActionType = typeof actionTypes;

type Action =
  | {
      type: ActionType['ADD_NOTIFICATION'];
      notification: NotificationPropsWithId;
    }
  | {
      type: ActionType['UPDATE_NOTIFICATION'];
      notification: Partial<NotificationPropsWithId>;
    }
  | {
      type: ActionType['DISMISS_NOTIFICATION'];
      notificationId?: NotificationPropsWithId['id'];
    }
  | {
      type: ActionType['REMOVE_NOTIFICATION'];
      notificationId?: NotificationPropsWithId['id'];
    };

interface State {
  notifications: NotificationPropsWithId[];
}

const notificationTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const addToRemoveQueue = (notificationId: string) => {
  if (notificationTimeouts.has(notificationId)) {
    return;
  }

  const timeout = setTimeout(() => {
    notificationTimeouts.delete(notificationId);
    dispatch({
      type: 'REMOVE_NOTIFICATION',
      notificationId: notificationId,
    });
  }, NOTIFICATION_REMOVE_DELAY);

  notificationTimeouts.set(notificationId, timeout);
};

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'ADD_NOTIFICATION':
      return {
        ...state,
        notifications: [action.notification, ...state.notifications].slice(
          0,
          NOTIFICATION_LIMIT,
        ),
      };

    case 'UPDATE_NOTIFICATION':
      return {
        ...state,
        notifications: state.notifications.map((t) =>
          t.id === action.notification.id
            ? { ...t, ...action.notification }
            : t,
        ),
      };

    case 'DISMISS_NOTIFICATION': {
      const { notificationId } = action;

      if (notificationId) {
        addToRemoveQueue(notificationId);
      } else {
        state.notifications.forEach((notification) => {
          addToRemoveQueue(notification.id);
        });
      }

      return {
        ...state,
        notifications: state.notifications.map((t) =>
          t.id === notificationId || notificationId === undefined
            ? {
                ...t,
                open: false,
              }
            : t,
        ),
      };
    }
    case 'REMOVE_NOTIFICATION':
      if (action.notificationId === undefined) {
        return {
          ...state,
          notifications: [],
        };
      }
      return {
        ...state,
        notifications: state.notifications.filter(
          (t) => t.id !== action.notificationId,
        ),
      };
  }
};

const listeners: Array<(state: State) => void> = [];

let memoryState: State = { notifications: [] };

function dispatch(action: Action) {
  if (action.type === 'ADD_NOTIFICATION') {
    const notificationExists = memoryState.notifications.some(
      (t) => t.id === action.notification.id,
    );
    if (notificationExists) {
      return;
    }
  }
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

type Notification = Omit<NotificationPropsWithId, 'id'>;

// 自动消失定时器
const autoDismissTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

function notification({ ...props }: Notification & { id?: string; duration?: number }) {
  const id = props?.id || genId();

  const update = (props: Notification) =>
    dispatch({
      type: 'UPDATE_NOTIFICATION',
      notification: { ...props, id },
    });
  const dismiss = () =>
    dispatch({ type: 'DISMISS_NOTIFICATION', notificationId: id });

  // 清除旧的自动消失定时器
  if (autoDismissTimeouts.has(id)) {
    clearTimeout(autoDismissTimeouts.get(id));
    autoDismissTimeouts.delete(id);
  }

  dispatch({
    type: 'ADD_NOTIFICATION',
    notification: {
      ...props,
      id,
      open: true,
      onOpenChange: (open: boolean) => {
        if (!open) dismiss();
      },
    },
  });

  // 设置自动消失（duration 为 0 或 undefined 时使用默认值，-1 表示不自动消失）
  const duration = props.duration ?? DEFAULT_DURATION;
  if (duration > 0) {
    const timeout = setTimeout(() => {
      autoDismissTimeouts.delete(id);
      dismiss();
    }, duration);
    autoDismissTimeouts.set(id, timeout);
  }

  return {
    id: id,
    dismiss,
    update,
  };
}

function useNotification() {
  const [state, setState] = React.useState<State>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, [state]);

  return {
    ...state,
    notification,
    dismiss: (notificationId?: string) =>
      dispatch({ type: 'DISMISS_NOTIFICATION', notificationId }),
  };
}

export { notification, useNotification };
