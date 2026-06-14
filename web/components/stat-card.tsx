"use client";

export type StatCardProps = {
  label: string;
  value: number;
  valueClass?: string;
  indicator?: string;
  /** 左侧强调条颜色 class */
  accentClass?: string;
};

export function StatCard({
  label,
  value,
  valueClass = "text-text-strong-950",
  indicator,
  accentClass = "bg-text-strong-950",
}: StatCardProps) {
  return (
    <div className="relative flex min-h-[88px] flex-col justify-center border-stroke-soft-200 px-4 py-4 first:border-l-0 md:px-5 md:py-5">
      <div className={`absolute left-0 top-3 bottom-3 w-0.5 rounded-full ${accentClass} md:top-4 md:bottom-4`} />
      <div className="flex items-center gap-2 pl-2">
        {indicator && <span className={`size-1.5 shrink-0 rounded-full ${indicator}`} />}
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-text-sub-600">
          {label}
        </span>
      </div>
      <div
        className={`mt-2 pl-2 font-mono text-4xl font-semibold leading-none tracking-tight tabular-nums md:text-5xl ${valueClass}`}
      >
        {value}
      </div>
    </div>
  );
}