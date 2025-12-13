// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as React from 'react';

declare module 'react' {
  interface CSSProperties {
    [key: `--${string}`]: string | number;
  }
}

interface RuntimeConfig {
  apiUrl?: string;
}

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: RuntimeConfig;
  }
}
