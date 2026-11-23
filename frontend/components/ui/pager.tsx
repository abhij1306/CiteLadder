import { useId, useLayoutEffect, useRef, useState } from 'react';

import { IconButton } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import {
  TABLE_DEFAULT_PAGE_SIZE,
  TABLE_PAGE_SIZE_OPTIONS,
  isTablePageSize,
  type TablePageSize,
} from '@/lib/config/tables';
import { ChevronLeft, ChevronRight, ChevronsLeft } from '@/lib/icons';
import { formatCount } from '@/lib/format';
import { useUrlState, type UrlCodec } from '@/lib/navigation/url-state';
import { cn } from '@/lib/utils';

type PagerRange = Readonly<{
  from: number;
  to: number;
  total?: number;
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
  onFirst?: () => void;
  range?: PagerRange;
  page?: number;
  pageCount?: number;
  pageSize?: PagerPageSize;
  busy?: boolean;
  hideWhenSinglePage?: boolean;
  className?: string;
}>;

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
  const face = 'type-body text-ink pe-2 whitespace-nowrap tabular-nums';
  if (range) {
    return (
      <output className={face}>
        {`${formatCount(range.from)}–${formatCount(range.to)}`}
        {range.total === undefined ? null : ` of ${formatCount(range.total)}`}
        <span className="sr-only">{` ${range.noun}`}</span>
      </output>
    );
  }
  if (!page) return null;
  return (
    <output className={face}>
      Page {page}
      {pageCount ? <span className="text-ink-2">{` of ${pageCount}`}</span> : null}
    </output>
  );
}

function PageSizeSelect({ pageSize, noun }: Readonly<{ pageSize: PagerPageSize; noun: string }>) {
  const id = useId();
  return (
    <div className="flex items-center gap-1">
      <label className="text-caption text-ink-2" htmlFor={id}>
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
        className="w-20 tabular-nums"
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
      {onFirst && canPrev ? (
        <IconButton
          variant="secondary"
          icon={ChevronsLeft}
          label="First page"
          tooltip={false}
          disabled={busy}
          onClick={onFirst}
        />
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
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
      <div className="flex items-center gap-2">
        <PagerSummary range={range} page={page} pageCount={pageCount} />
        <PagerSteps {...steps} busy={busy} />
      </div>
      {pageSize ? <PageSizeSelect pageSize={pageSize} noun={range?.noun ?? 'rows'} /> : null}
    </div>
  );
}

export function useTablePage(
  total: number,
  {
    pageSize,
    resetKey,
    urlKey,
  }: Readonly<{ pageSize: number; resetKey?: string; urlKey?: string }>,
) {
  const [localPage, setLocalPage] = useState(1);
  const [urlPage, setUrlPage] = useUrlState(urlKey ?? '', PAGE_CODEC);
  const page = urlKey ? urlPage : localPage;
  const setPage: (page: number) => void = urlKey ? setUrlPage : setLocalPage;
  const [pagedKey, setPagedKey] = useState(resetKey);
  if (pagedKey !== resetKey) {
    setPagedKey(resetKey);
    setLocalPage(1);
  }
  const lastKey = useRef(resetKey);
  useLayoutEffect(() => {
    if (lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    if (urlKey) setUrlPage(1, 'replace');
  }, [resetKey, urlKey, setUrlPage]);
  const safePageSize = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.max(1, Math.min(page, pageCount));
  const from = total === 0 ? 0 : (safePage - 1) * safePageSize + 1;
  const to = Math.min(total, safePage * safePageSize);
  return { page: safePage, setPage, pageCount, from, to };
}

const PAGE_CODEC: UrlCodec<number> = {
  parse: (raw) => {
    const page = Number(raw);
    return Number.isSafeInteger(page) && page > 1 ? page : 1;
  },
  serialize: (page) => (page > 1 ? String(page) : null),
};

const PAGE_SIZE_CODEC: UrlCodec<TablePageSize> = {
  parse: (raw) => {
    const size = Number(raw);
    return isTablePageSize(size) ? size : TABLE_DEFAULT_PAGE_SIZE;
  },
  serialize: (size) => (size === TABLE_DEFAULT_PAGE_SIZE ? null : String(size)),
};

export function useResizableTablePage(
  total: number,
  { resetKey, urlKey }: Readonly<{ resetKey?: string; urlKey?: string }> = {},
) {
  const [localSize, setLocalSize] = useState<TablePageSize>(TABLE_DEFAULT_PAGE_SIZE);
  const [urlSize, setUrlSize] = useUrlState(urlKey ? `${urlKey}_size` : '', PAGE_SIZE_CODEC, {
    clearKeys: urlKey ? [urlKey] : [],
  });
  const pageSize = urlKey ? urlSize : localSize;
  const pagination = useTablePage(total, { pageSize, resetKey, urlKey });
  const { setPage } = pagination;
  const pageSizeControl: PagerPageSize = {
    value: pageSize,
    onChange: (size) => {
      const next = isTablePageSize(size) ? size : TABLE_DEFAULT_PAGE_SIZE;
      if (urlKey) return setUrlSize(next);
      setLocalSize(next);
      setPage(1);
    },
  };
  return { ...pagination, pageSize, pageSizeControl };
}
