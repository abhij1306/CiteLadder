import { useId, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button, IconButton } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { TABLE_PAGE_SIZE_OPTIONS } from '@/lib/config/tables';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Pager — the one footer for a paged list or table: the rows-per-page select
 * (when offered) on the left; the range ("1–25 of 120", tabular, the total in
 * `ink-muted`) and the previous and next 36px secondary icon buttons on the
 * right. An arrow at either end disables rather than disappearing, so the
 * pager keeps its place.
 *
 * Two modes, one component — the difference is what the caller knows:
 *
 *   - **Page-number** (an offset list that holds the whole result): pass
 *     `page` and `pageCount`, or a `range` with a `total`; use
 *     `pageNumberControls(page, pageCount, setPage)` for the four handlers.
 *   - **Cursor** (keyset): the caller holds a cursor stack and knows only
 *     whether another page exists. Pass `canPrev`/`canNext`, the visible
 *     `range` with `total` only when a persisted exact count exists (never a
 *     live `COUNT(*)`), or `page` for "Page N". `onFirst` adds a "First page"
 *     jump for a forward-only cursor that cannot step back one page.
 *
 * `hideWhenSinglePage` renders nothing when neither direction leads anywhere —
 * two permanently disabled buttons are noise. The summary is a polite live
 * region so the new position is announced after a page turn.
 */
type PagerRange = Readonly<{
  from: number;
  to: number;
  /** Exact persisted total, or undefined when no exact count exists. */
  total?: number;
  /** Row noun, e.g. "prompts". */
  noun: string;
}>;

type PagerPageSize = Readonly<{
  value: number;
  onChange: (size: number) => void;
}>;

type PagerProps = Readonly<{
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Cursor mode: jump back to the first page. */
  onFirst?: () => void;
  range?: PagerRange;
  /** One-based current page. */
  page?: number;
  /** Known page count (page-number mode). */
  pageCount?: number;
  /** Rows-per-page selector. */
  pageSize?: PagerPageSize;
  /** Disables navigation while a page is in flight. */
  busy?: boolean;
  hideWhenSinglePage?: boolean;
  className?: string;
}>;

/** The four handlers for a page-number list. */
export function pageNumberControls(
  page: number,
  pageCount: number,
  onPageChange: (page: number) => void,
) {
  return {
    page,
    pageCount,
    canPrev: page > 1,
    canNext: page < pageCount,
    onPrev: () => onPageChange(page - 1),
    onNext: () => onPageChange(page + 1),
  };
}

function PagerSummary({
  range,
  page,
  pageCount,
}: Readonly<{ range?: PagerRange; page?: number; pageCount?: number }>) {
  // Tabular figures hold every digit to one width, so the range does not
  // change width as the reader pages.
  const face = 'text-body-sm text-ink pe-2 whitespace-nowrap tabular-nums';
  if (range) {
    return (
      <output className={face}>
        {range.from}–{range.to}
        <span className="text-ink-muted">
          {range.total === undefined ? null : ` of ${formatCount(range.total)}`} {range.noun}
        </span>
      </output>
    );
  }
  if (!page) return null;
  return (
    <output className={face}>
      Page {page}
      {pageCount ? <span className="text-ink-muted">{` of ${pageCount}`}</span> : null}
    </output>
  );
}

function PageSizeSelect({ pageSize, noun }: Readonly<{ pageSize: PagerPageSize; noun: string }>) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label className="text-caption text-ink-muted" htmlFor={id}>
        Rows per page
      </label>
      <Select
        id={id}
        ariaLabel={`Rows per page for ${noun}`}
        value={String(pageSize.value)}
        onValueChange={(value) => pageSize.onChange(Number(value))}
        options={TABLE_PAGE_SIZE_OPTIONS.map((size) => ({
          value: String(size),
          label: String(size),
        }))}
        className="w-20 font-mono"
      />
    </div>
  );
}

function PagerSteps({
  canPrev,
  canNext,
  onPrev,
  onNext,
  onFirst,
  busy,
}: Readonly<
  Pick<PagerProps, 'canPrev' | 'canNext' | 'onPrev' | 'onNext' | 'onFirst'> & { busy: boolean }
>) {
  return (
    <div className="flex items-center gap-2">
      {onFirst ? (
        <Button variant="secondary" disabled={!canPrev || busy} onClick={onFirst}>
          First page
        </Button>
      ) : null}
      <IconButton
        variant="secondary"
        icon={ChevronLeft}
        label="Previous page"
        tooltip={false}
        disabled={!canPrev || busy}
        onClick={onPrev}
      />
      <IconButton
        variant="secondary"
        icon={ChevronRight}
        label="Next page"
        tooltip={false}
        disabled={!canNext || busy}
        onClick={onNext}
      />
    </div>
  );
}

export function Pager({
  range,
  page,
  pageCount,
  pageSize,
  busy = false,
  hideWhenSinglePage = false,
  className,
  ...steps
}: PagerProps) {
  if (hideWhenSinglePage && !steps.canPrev && !steps.canNext) return null;
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      {pageSize ? <PageSizeSelect pageSize={pageSize} noun={range?.noun ?? 'rows'} /> : <span />}
      <div className="flex items-center gap-2">
        <PagerSummary range={range} page={page} pageCount={pageCount} />
        <PagerSteps {...steps} busy={busy} />
      </div>
    </div>
  );
}

/**
 * Page state for an offset-paged list, with clamp-only reconciliation: when
 * the underlying list shrinks (filters, deletes, polling refetches) the page
 * clamps into range instead of resetting, so a background refetch never yanks
 * the reader back to page 1.
 */
export function useTablePage(total: number, pageSize: number) {
  const [page, setPage] = useState(1);
  const safePageSize = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.max(1, Math.min(page, pageCount));
  const from = total === 0 ? 0 : (safePage - 1) * safePageSize + 1;
  const to = Math.min(total, safePage * safePageSize);
  return { page: safePage, setPage, pageCount, from, to };
}
