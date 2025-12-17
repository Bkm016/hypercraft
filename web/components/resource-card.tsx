"use client";

import type { RemixiconComponentType } from "@remixicon/react";

const colorMap = {
  primary: {
    bg: "bg-primary-alpha-10",
    fill: "bg-text-strong-950",
    text: "text-primary-base",
  },
  success: {
    bg: "bg-success-lighter",
    fill: "bg-success-base",
    text: "text-success-base",
  },
  away: {
    bg: "bg-away-lighter",
    fill: "bg-away-base",
    text: "text-away-base",
  },
  error: {
    bg: "bg-error-lighter",
    fill: "bg-error-base",
    text: "text-error-base",
  },
} as const;

export type ResourceCardProps = {
  icon: RemixiconComponentType;
  label: string;
  value: string;
  usage: number;
  color: keyof typeof colorMap;
};

export function ResourceCard({ icon: Icon, label, value, usage, color }: ResourceCardProps) {
  const colors = colorMap[color];

  return (
    <div className="flex items-center gap-3 rounded-lg border border-stroke-soft-200 p-3 sm:p-4">
      <div className={`shrink-0 rounded-lg p-2 ${colors.bg}`}>
        <Icon className={`size-4 sm:size-5 ${colors.text}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs sm:text-sm text-text-sub-600">{label}</span>
          <span className="text-xs sm:text-sm font-medium text-text-strong-950 tabular-nums">
            {usage.toFixed(1)}%
          </span>
        </div>
        <div className={`mt-1.5 h-1.5 sm:h-2 rounded-full ${colors.bg} overflow-hidden`}>
          <div
            className={`h-full rounded-full ${colors.fill} transition-all duration-300`}
            style={{ width: `${Math.min(100, usage)}%` }}
          />
        </div>
        <div className="mt-1 text-[10px] sm:text-xs text-text-soft-400 truncate">{value}</div>
      </div>
    </div>
  );
}
