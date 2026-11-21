import { TableHead } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { textRole } from '@/components/ui/typography';
import { ArrowDown } from '@/lib/icons';
import { cn } from '@/lib/utils';

type HeadOptions = { numeric?: boolean; desktopOnly?: boolean };

export function HintedTableHead({
  label,
  hint,
  numeric,
  desktopOnly,
}: Readonly<{ label: string; hint: string } & HeadOptions>) {
  return (
    <TableHead numeric={numeric} desktopOnly={desktopOnly}>
      <Tooltip content={hint}>
        <button
          type="button"
          className="focus-ring rounded-mark inline-flex min-h-[var(--control-sm)] cursor-default items-center"
        >
          {label}
        </button>
      </Tooltip>
    </TableHead>
  );
}

const SORT_ALIGN = {
  start: { column: 'items-start', row: 'justify-start text-left' },
  end: { column: 'items-end', row: 'justify-end text-right' },
} as const;

export function SortableTableHead({
  label,
  active,
  descending,
  onSort,
  numeric,
  sublabel,
  hint,
  desktopOnly,
  className,
}: Readonly<{
  desktopOnly?: boolean;
  label: string;
  active: boolean;
  descending: boolean;
  onSort: () => void;
  numeric?: boolean;
  sublabel?: string;
  hint?: string;
  className?: string;
}>) {
  let ariaSort: 'ascending' | 'descending' | undefined;
  if (active) ariaSort = descending ? 'descending' : 'ascending';
  const align = numeric ? SORT_ALIGN.end : SORT_ALIGN.start;
  const button = (
    <button
      type="button"
      onClick={onSort}
      className={cn(
        'focus-ring inline-flex min-h-[var(--control-sm)] w-full flex-col justify-center rounded-mark transition-colors',
        align.column,
        !active && 'hover:text-ink',
      )}
    >
      <span
        className={cn(
          'inline-flex w-full items-center gap-1',
          numeric ? 'flex-row-reverse justify-start text-right' : align.row,
        )}
      >
        <span>{label}</span>
        <ArrowDown
          className={cn(
            'size-3 shrink-0 transition-transform',
            active ? !descending && 'rotate-180' : 'opacity-0 group-hover:opacity-50',
          )}
          aria-hidden
        />
      </span>
      {sublabel ? <span className={textRole('caption')}>{sublabel}</span> : null}
    </button>
  );
  return (
    <TableHead
      numeric={numeric}
      desktopOnly={desktopOnly}
      aria-sort={ariaSort}
      className={cn('group', className)}
    >
      {hint ? <Tooltip content={hint}>{button}</Tooltip> : button}
    </TableHead>
  );
}
