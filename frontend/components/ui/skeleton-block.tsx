import { useEffect, useState, type ReactNode } from 'react';
import { cssVars } from '@/lib/css-vars';

import type { ChartHeight } from '@/components/ui/chart';
import { figureRowCells, useStripWidth } from '@/components/ui/figure-rows';
import { LOADING_INDICATOR_DELAY_MS } from '@/lib/config/operational';
import { cn } from '@/lib/utils';

export function SkeletonBlock({ className }: Readonly<{ className?: string }>) {
  return (
    <span
      aria-hidden
      data-skeleton-block=""
      className={cn('skeleton-sweep bg-well rounded-mark block h-3 min-h-3', className)}
    />
  );
}

export const TEXT_WIDTHS = ['w-full', 'w-4/5', 'w-3/5'] as const;

export type LoadingShape =
  | Readonly<{ kind: 'table'; columns?: number; desktopOnly?: number }>
  | Readonly<{ kind: 'figures'; count?: number }>
  | Readonly<{ kind: 'chart'; height?: ChartHeight; keyed?: boolean }>
  | Readonly<{ kind: 'facts'; rows?: number; tagRows?: readonly number[] }>
  | Readonly<{ kind: 'list'; rows?: number }>
  | Readonly<{ kind: 'thread' }>;

const CHART_HEIGHT: Record<ChartHeight, string> = {
  sm: 'h-[var(--chart-height-sm)]',
  md: 'h-[var(--chart-height-md)]',
  lg: 'h-[var(--chart-height-lg)]',
};

export function ShapeBlocks({ shape }: Readonly<{ shape: LoadingShape }>) {
  return (
    <div className="skeleton-sweep grid min-w-0">
      <ShapeBody shape={shape} />
    </div>
  );
}

function ShapeBody({ shape }: Readonly<{ shape: LoadingShape }>) {
  switch (shape.kind) {
    case 'table':
      return <TableBlocks columns={shape.columns} desktopOnly={shape.desktopOnly} />;
    case 'figures':
      return <FigureBlocks count={shape.count} />;
    case 'chart': {
      const plot = <SkeletonBlock className={cn('w-full', CHART_HEIGHT[shape.height ?? 'md'])} />;
      return shape.keyed ? <KeyedChartBlocks plot={plot} /> : plot;
    }
    case 'facts':
      return <FactBlocks rows={shape.rows} tagRows={shape.tagRows} />;
    case 'list':
      return <ListBlocks rows={shape.rows} />;
    case 'thread':
      return <ThreadBlocks />;
    default: {
      const exhaustive: never = shape;
      return exhaustive;
    }
  }
}

const range = (count: number) => Array.from({ length: count }, (_, index) => index);

function CaptionLine({ width }: Readonly<{ width: string }>) {
  return (
    <span className="type-caption flex h-lh items-center">
      <SkeletonBlock className={width} />
    </span>
  );
}

function KeyedChartBlocks({ plot }: Readonly<{ plot: ReactNode }>) {
  return (
    <div className="grid gap-[var(--compact-gap)]">
      <div className="flex min-w-0 flex-col gap-4">
        <CaptionLine width="w-48" />
        {plot}
        <CaptionLine width="w-3/5" />
      </div>
      <CaptionLine width="w-2/5" />
    </div>
  );
}

function TitleBlock() {
  return <SkeletonBlock className="h-4 w-40 max-w-full" />;
}

export function WidgetCardBlocks({ shape }: Readonly<{ shape: LoadingShape }>) {
  return (
    <div className="skeleton-sweep flex h-full flex-col gap-[var(--workspace-gap)]">
      <span className="flex h-6 items-center">
        <TitleBlock />
      </span>
      <ShapeBlocks shape={shape} />
    </div>
  );
}

export function ReportSkeletonFrame({
  label,
  variant,
  children,
}: Readonly<{ label: string; variant: string; children: ReactNode }>) {
  return (
    <SkeletonFrame
      label={label}
      variant={variant}
      className="flex flex-col gap-[var(--page-top-gap)]"
    >
      <span className="flex h-4 items-center">
        <SkeletonBlock className="w-60 max-w-full" />
      </span>
      {children}
    </SkeletonFrame>
  );
}

function FactBlocks({
  rows = 3,
  tagRows = [],
}: Readonly<{ rows?: number; tagRows?: readonly number[] }>) {
  return (
    <span className="grid">
      {range(rows).map((row) => (
        <span key={row} className="flex h-10 items-center gap-4">
          <SkeletonBlock className="h-4 w-[30%]" />
          {tagRows.includes(row) ? (
            <SkeletonBlock className="h-6 w-16" />
          ) : (
            <SkeletonBlock className="h-5 w-[45%]" />
          )}
        </span>
      ))}
    </span>
  );
}

function ListBlocks({ rows = 3 }: Readonly<{ rows?: number }>) {
  return (
    <span className="grid">
      {range(rows).map((row) => (
        <span key={row} className="flex h-12 items-center gap-3">
          <SkeletonBlock className="size-8 shrink-0" />
          <span className="grid min-w-0 flex-1 gap-1">
            <SkeletonBlock className="h-4 w-1/2" />
            <SkeletonBlock className="w-[30%]" />
          </span>
        </span>
      ))}
    </span>
  );
}

const CELL_WIDTHS = ['w-2/5', 'w-1/5', 'w-[15%]', 'w-[15%]'] as const;

function cellWidth(columns: number, cell: number): string {
  if (columns === CELL_WIDTHS.length) return CELL_WIDTHS[cell] ?? 'flex-1';
  return cell === 0 ? 'w-2/5' : 'flex-1';
}

export function TableBlocks({
  columns = 4,
  desktopOnly = 0,
  rows = 5,
}: Readonly<{ columns?: number; desktopOnly?: number; rows?: number }>) {
  const cells = range(Math.max(1, columns));
  const width = (cell: number) =>
    cn(cellWidth(columns, cell), cell >= columns - desktopOnly && 'desktop:block hidden');
  return (
    <span className="grid">
      <span className="bg-well rounded-mark block h-[var(--table-header-height)]" />
      {range(rows).map((row) => (
        <span key={row} className="flex h-10 items-center gap-4 px-4">
          {cells.map((cell) => (
            <SkeletonBlock key={cell} className={cn('h-7', width(cell))} />
          ))}
        </span>
      ))}
    </span>
  );
}

export function FigureBlocks({ count = 3 }: Readonly<{ count?: number }>) {
  const { ref, width } = useStripWidth<HTMLSpanElement>();
  const cells = figureRowCells({ count, width });
  return (
    <span ref={ref} data-figure-strip="" className="flex min-w-0 flex-wrap">
      {cells.map((size, index) => (
        <span key={index} data-figure-cell="" style={cssVars({ '--row': size })}>
          <span className="flex h-4 items-center">
            <SkeletonBlock className="h-3 w-1/2" />
          </span>
          <span data-figure-value="" className="flex items-center">
            <SkeletonBlock className="h-5 w-20 max-w-full" />
          </span>
        </span>
      ))}
    </span>
  );
}

function ThreadBlocks() {
  return (
    <span className="grid gap-[var(--card-padding)] px-4">
      <SkeletonBlock className="rounded-card ms-auto h-10 w-[45%]" />
      <span className="grid gap-2">
        <SkeletonBlock className="h-4 w-full" />
        <SkeletonBlock className="h-4 w-[70%]" />
      </span>
    </span>
  );
}

export function ComposerBlocks() {
  return (
    <span className="bg-surface border-rule rounded-card shadow-pop grid gap-1 border p-2">
      <span className="block h-[30px]" />
      <span className="flex h-[var(--control-md)] items-center justify-end">
        <SkeletonBlock className="size-8 rounded-full" />
      </span>
    </span>
  );
}

export function SkeletonFrame({
  label,
  variant,
  className,
  children,
}: Readonly<{ label: string; variant: string; className?: string; children: ReactNode }>) {
  return (
    <div aria-busy="true" data-skeleton={variant} className={cn('min-w-0', className)}>
      <LiveVerb label={label} />
      {children}
    </div>
  );
}

let revealedLoaders = 0;

export function LiveVerb({ label }: Readonly<{ label: string }>) {
  const [revealed, setRevealed] = useState(() => revealedLoaders > 0);
  useEffect(() => {
    if (!revealed) {
      const timer = setTimeout(() => setRevealed(true), LOADING_INDICATOR_DELAY_MS);
      return () => clearTimeout(timer);
    }
    revealedLoaders += 1;
    return () => {
      revealedLoaders -= 1;
    };
  }, [revealed]);
  return revealed ? <output aria-label={label} className="sr-only" /> : null;
}
