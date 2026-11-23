import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from 'react';

import {
  columnRules,
  fitFloor,
  SELECT_WIDTH,
  withEdges,
  type DataTableColumn,
} from '@/components/ui/data-table-columns';

export type FitColumn = Readonly<{ floor: number; low: boolean }>;

const tableFloor = (columns: readonly FitColumn[], select: number) =>
  columns.reduce((sum, column) => sum + column.floor, select);

export function hiddenLowColumns({
  columns,
  select,
  frame,
}: Readonly<{ columns: readonly FitColumn[]; select: number; frame: number }>): number[] {
  const hidden = new Set<number>();
  const lowFromEnd = columns.flatMap((column, index) => (column.low ? [index] : [])).reverse();
  for (const index of lowFromEnd) {
    const shown = columns.filter((_, at) => !hidden.has(at));
    if (tableFloor(shown, select) <= frame) break;
    hidden.add(index);
  }
  return [...hidden].sort((a, b) => a - b);
}

export const ShownColumnsContext = createContext<ReadonlySet<string> | undefined>(undefined);

export function useShownSpan(keys: readonly string[]): number {
  const shown = useContext(ShownColumnsContext);
  return shown ? keys.filter((key) => shown.has(key)).length : keys.length;
}

const sameList = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export function useFittedColumns({
  columns,
  selection,
}: Readonly<{ columns: readonly DataTableColumn[]; selection: boolean }>) {
  const scope = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<readonly number[]>([]);
  const hasLow = columns.some((column) => column.priority === 'low');

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const probe = probeRef.current;
    if (!hasLow || !frame || !probe || typeof ResizeObserver === 'undefined') {
      setHidden((previous) => (previous.length ? [] : previous));
      return;
    }
    const update = () => {
      const width = frame.getBoundingClientRect().width;
      if (width === 0) return;
      const [select = 0, ...floors] = [...probe.children].map(
        (child) => child.getBoundingClientRect().width,
      );
      const next = hiddenLowColumns({
        columns: columns.map((column, index) => ({
          floor: floors[index] ?? 0,
          low: column.priority === 'low',
        })),
        select: selection ? select : 0,
        frame: width,
      });
      setHidden((previous) => (sameList(previous, next) ? previous : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [columns, hasLow, selection]);

  const hiddenSet = new Set(hidden);
  const shown = columns.filter((_, index) => !hiddenSet.has(index));
  return {
    frameRef,
    shown,
    shownKeys: new Set(shown.map((column) => column.key)),
    scope,
    probe: (
      <>
        {hasLow ? <FloorProbe ref={probeRef} columns={columns} selection={selection} /> : null}
        <style>{columnRules({ scope, columns, hidden, selection })}</style>
      </>
    ),
  };
}

function FloorProbe({
  ref,
  columns,
  selection,
}: Readonly<{
  ref: Ref<HTMLDivElement>;
  columns: readonly DataTableColumn[];
  selection: boolean;
}>) {
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none invisible absolute h-0 overflow-hidden"
    >
      <div style={{ width: SELECT_WIDTH }} />
      {withEdges(columns, selection).map(({ column, edge }) => (
        <div
          key={column.key}
          className={column.desktopOnly ? 'desktop:block hidden' : undefined}
          style={{ width: fitFloor(column, edge) }}
        />
      ))}
    </div>
  );
}
