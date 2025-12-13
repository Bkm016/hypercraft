"use client";

export type StatCardProps = {
  label: string;
  value: number;
  valueClass?: string;
  indicator?: string;
};

export function StatCard({ label, value, valueClass = "text-text-strong-950", indicator }: StatCardProps) {
  return (
    <div className="rounded-xl border border-stroke-soft-200 bg-bg-white-0 p-3 sm:p-5">
      <div className="flex items-center gap-1.5 sm:gap-2">
        {indicator && <span className={`size-1.5 sm:size-2 rounded-full ${indicator}`} />}
        <span className="text-xs sm:text-sm text-text-sub-600">{label}</span>
      </div>
      <div className={`mt-1 sm:mt-2 text-2xl sm:text-3xl font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
    </div>
  );
}
