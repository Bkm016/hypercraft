"use client";

import type { RemixiconComponentType } from "@remixicon/react";

const colorMap = {
  primary: { fill: "bg-text-strong-950", text: "text-text-strong-950", bar: "bg-bg-soft-200" },
  success: { fill: "bg-success-base", text: "text-success-base", bar: "bg-success-lighter" },
  away: { fill: "bg-away-base", text: "text-away-base", bar: "bg-away-lighter" },
  error: { fill: "bg-error-base", text: "text-error-base", bar: "bg-error-lighter" },
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
    <div className="flex w-full flex-col px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={`size-4 shrink-0 ${colors.text}`} />
          <span className="text-base font-medium text-text-strong-950">{label}</span>
        </div>
        <span className={`shrink-0 text-xl font-semibold tabular-nums sm:text-2xl ${colors.text}`}>
          {usage.toFixed(1)}%
        </span>
      </div>

      <div className={`mt-3 h-1.5 w-full overflow-hidden rounded-full ${colors.bar}`}>
        <div
          className={`h-full rounded-full ${colors.fill} transition-all duration-300`}
          style={{ width: `${Math.min(100, usage)}%` }}
        />
      </div>

      <p className="mt-2.5 truncate text-left text-xs text-text-sub-600 sm:text-sm">{value}</p>
    </div>
  );
}