"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

export interface GroupMasonryItem {
  key: string;
  node: ReactNode;
  /** 用于最短列分配的大致高度（px） */
  estimateHeight: number;
}

const GAP_PX = 16;

function assignShortestColumn(heights: number[]): number[] {
  const colHeights = [0, 0];
  const cols: number[] = [];
  for (let i = 0; i < heights.length; i++) {
    const col = colHeights[0] <= colHeights[1] ? 0 : 1;
    cols.push(col);
    colHeights[col] += heights[i] + GAP_PX;
  }
  return cols;
}

export function GroupMasonry({ items }: { items: GroupMasonryItem[] }) {
  const [twoColumn, setTwoColumn] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setTwoColumn(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const columnOf = useMemo(() => {
    if (!twoColumn) return items.map(() => 0);
    return assignShortestColumn(items.map((i) => i.estimateHeight));
  }, [items, twoColumn]);

  if (items.length === 0) return null;

  if (!twoColumn) {
    return (
      <div className="flex flex-col gap-4">
        {items.map((item) => (
          <div key={item.key}>{item.node}</div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 items-start gap-4">
      <div className="flex flex-col gap-4">
        {items.map((item, i) =>
          columnOf[i] === 0 ? <div key={item.key}>{item.node}</div> : null,
        )}
      </div>
      <div className="flex flex-col gap-4">
        {items.map((item, i) =>
          columnOf[i] === 1 ? <div key={item.key}>{item.node}</div> : null,
        )}
      </div>
    </div>
  );
}

export function estimateGroupCardHeight(serviceCount: number, collapsed: boolean): number {
  const header = 44;
  if (collapsed || serviceCount === 0) return header;
  const row = 34;
  const list = serviceCount * row;
  const pad = 16;
  return header + list + pad;
}