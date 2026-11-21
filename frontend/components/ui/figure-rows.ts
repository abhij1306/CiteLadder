import { useLayoutEffect, useRef, useState } from 'react';

export const FIGURE_MIN_WIDTH = 160;
const THREE_MIN_WIDTH = 128;
const NARROW_STRIP = 480;

function rowCap(count: number): number {
  return count <= 6 ? 3 : 4;
}

function balancedRows(count: number, cap: number): number[] {
  const rows = Math.ceil(count / cap);
  const base = Math.floor(count / rows);
  const extra = count % rows;
  return Array.from({ length: rows }, (_, index) => base + (index < extra ? 1 : 0));
}

export const cellWidth = (width: number, perRow: number) => width / perRow;

type StripFit = Readonly<{ count: number; width: number }>;

export function figureRows({ count, width }: StripFit): number[] {
  if (count <= 0) return [];
  const fits = (perRow: number) => cellWidth(width, perRow) >= FIGURE_MIN_WIDTH;
  if (count <= 2) return [count];
  if (count === 3) return rowsOfThree(width);
  if (width < NARROW_STRIP) return balancedPairs(count);
  if (count <= 6 && fits(count)) return [count];
  for (let cap = rowCap(count); cap >= 3; cap -= 1) {
    if (fits(cap)) return balancedRows(count, cap);
  }
  const pairs = balancedPairs(count);
  if (pairs.at(-1) === 1) {
    pairs.pop();
    pairs[pairs.length - 1] = 3;
  }
  return [...pairs].sort((a, b) => b - a);
}

function rowsOfThree(width: number): number[] {
  if (cellWidth(width, 3) >= THREE_MIN_WIDTH) return [3];
  if (width < NARROW_STRIP && cellWidth(width, 2) >= FIGURE_MIN_WIDTH) return balancedPairs(3);
  return [1, 1, 1];
}

function balancedPairs(count: number): number[] {
  return Array.from({ length: Math.ceil(count / 2) }, (_, index) => Math.min(2, count - index * 2));
}

export function figureRowCells(fit: StripFit): number[] {
  const rows = figureRows(fit);
  const columns = rows[0] ?? 1;
  return rows.flatMap((count) => Array.from({ length: count }, () => columns));
}

export function useStripWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const measured = node.getBoundingClientRect().width;
    if (measured > 0) setWidth(measured);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
