import { cn } from '@/lib/utils';

/** One placeholder shape: `surface-sunken`, `radius-xs`, a gentle 1.6s pulse (still under reduced motion). */
const BAR = 'bg-surface-sunken block rounded-xs animate-skeleton-pulse';

const ROW_WIDTHS = ['62%', '48%', '70%', '54%', '40%'] as const;

type SkeletonProps = Readonly<{
  /** Screen-reader text. */
  label?: string;
  className?: string;
}> &
  (
    | Readonly<{ variant?: 'text'; lines?: number; rows?: never }>
    | Readonly<{ variant: 'row'; rows?: number; lines?: never }>
    | Readonly<{ variant: 'block' | 'chart'; lines?: never; rows?: never }>
  );

/**
 * Skeleton — placeholder shapes that hold the final layout while data loads,
 * so nothing moves when it arrives. Tables, lists and charts load with these,
 * never spinners.
 *
 *   `text`  — `lines` body-sm line boxes (20px) each holding a 10px bar, the
 *             last at 60%.
 *   `row`   — `rows` 44px list or table rows (a 16px icon block, a bar and a
 *             short meta bar) divided by `line` rules.
 *   `block` — a 160px block with `radius-lg`, for a card's body.
 *   `chart` — a block at the chart's height.
 *
 * Match the count of what will load: a 25-row table loads 25 rows.
 */
export function Skeleton(props: SkeletonProps) {
  const { label = 'Loading', className } = props;
  const variant = props.variant ?? 'text';
  return (
    <output aria-busy="true" aria-label={label} className={cn('block min-w-0', className)}>
      <span aria-hidden className={cn('flex flex-col', variant === 'text' && 'gap-1')}>
        <SkeletonBody {...props} />
      </span>
    </output>
  );
}

function SkeletonBody(props: SkeletonProps) {
  switch (props.variant) {
    case 'row':
      return Array.from({ length: props.rows ?? 3 }, (_, index) => (
        <span
          key={index}
          className="border-line flex h-[var(--table-row-height)] items-center gap-3 px-3 [&+&]:border-t"
        >
          <span className={cn(BAR, 'size-4 shrink-0')} />
          {/* A table row tall (`table-row-height`), holding one body-sm line box. */}
          <span className="flex h-5 min-w-0 flex-1 items-center">
            <span
              className={cn(BAR, 'h-2.5')}
              style={{ width: ROW_WIDTHS[index % ROW_WIDTHS.length] }}
            />
          </span>
          <span className={cn(BAR, 'h-2.5 w-14 shrink-0')} />
        </span>
      ));
    case 'block':
      return <span className={cn(BAR, 'h-40 w-full rounded-lg')} />;
    case 'chart':
      return <span className={cn(BAR, 'h-[var(--chart-height-md)] w-full rounded-lg')} />;
    default: {
      const lines = props.lines ?? 3;
      return Array.from({ length: lines }, (_, index) => (
        <span key={index} className="flex h-5 items-center">
          <span
            className={cn(BAR, 'h-2.5')}
            style={{ width: lines > 1 && index === lines - 1 ? '60%' : '100%' }}
          />
        </span>
      ));
    }
  }
}
