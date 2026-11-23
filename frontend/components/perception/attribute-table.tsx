import { Fragment, useState } from 'react';
import type {
  PerceptionQuote,
  PerceptionResponse,
} from '@citeladder/contracts/visibility-perception';

import { ExpandToggle } from '@/components/perception/expand-toggle';
import { AnswerLink } from '@/components/runs/answer-link';
import { Absence } from '@/components/ui/absence';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { useShownSpan } from '@/components/ui/data-table-fit';
import { EngineMark, engineMarkKey } from '@/components/ui/engine-mark';
import { SearchField } from '@/components/ui/search-field';
import { StatusMark } from '@/components/ui/status-mark';
import { TableCell, TableRow } from '@/components/ui/table';
import { SegmentedControl } from '@/components/ui/tabs';
import { Tag } from '@/components/ui/tag';
import { textRole } from '@/components/ui/typography';
import { formatCount } from '@/lib/format';
import { optionalStringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useEngineCatalog } from '@/lib/providers/engines';
import { cn } from '@/lib/utils';
import {
  categoryShare,
  filterCategories,
  SMALL_SAMPLE,
  sortCategories,
  type CategorySort,
  type Polarity,
} from '@/lib/visibility/perception';

type Category = PerceptionResponse['entities'][number]['categories'][number];
type Side = Polarity | 'all';

const SIDES = [
  { value: 'all', label: 'All' },
  { value: 'negative', label: 'Negative' },
  { value: 'positive', label: 'Positive' },
] as const satisfies readonly { value: Side; label: string }[];

export function AttributeTable({ categories }: Readonly<{ categories: readonly Category[] }>) {
  const [query, setQuery] = useState('');
  const [side, setSide] = useState<Side>('all');
  const [sort, setSort] = useState<CategorySort | null>(null);
  const [open, setOpen] = useUrlState('attribute', optionalStringUrlCodec, { history: 'replace' });
  const shown = filterCategories(categories, { query, polarity: side });
  const rows = sort ? sortCategories(shown, sort) : shown;
  const sortable = (key: CategorySort['key']) => ({
    active: sort?.key === key,
    descending: sort?.key === key ? sort.descending : key !== 'attribute',
    onSort: () =>
      setSort({
        key,
        descending: sort?.key === key ? !sort.descending : key !== 'attribute',
      }),
  });
  const columns: readonly DataTableColumn[] = [
    { key: 'attribute', label: 'Attribute', sort: sortable('attribute') },
    { key: 'negative', label: 'Negative', kind: 'number', sort: sortable('negative') },
    { key: 'positive', label: 'Positive', kind: 'number', sort: sortable('positive') },
    { key: 'share', label: 'Share negative', kind: 'number', width: 'metric' },
    {
      key: 'split',
      label: 'Negative vs positive',
      width: 'category',
      priority: 'low',
      sort: sortable('share'),
    },
  ];
  const narrowed = Boolean(query.trim()) || side !== 'all';
  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchField
          value={query}
          onValueChange={setQuery}
          aria-label="Search attributes"
          placeholder="Search attributes"
          className="phone:w-full w-60"
        />
        <SegmentedControl value={side} onChange={setSide} options={SIDES} ariaLabel="Side" />
      </div>
      <DataTable
        label="Attributes"
        columns={columns}
        state={
          rows.length || !narrowed
            ? undefined
            : {
                kind: 'filtered',
                headingLevel: 3,
                heading: 'No matches',
                onClear: () => {
                  setQuery('');
                  setSide('all');
                },
              }
        }
      >
        {rows.map((category) => (
          <CategoryRow
            key={category.category}
            category={category}
            open={open === category.category}
            onToggle={() => setOpen(open === category.category ? null : category.category)}
          />
        ))}
      </DataTable>
    </div>
  );
}

function CategoryRow({
  category,
  open,
  onToggle,
}: Readonly<{ category: Category; open: boolean; onToggle: () => void }>) {
  const share = categoryShare(category);
  const quotes = category.attributes.flatMap((attribute) =>
    attribute.quotes.map((quote) => ({ attribute: attribute.attribute, quote })),
  );
  return (
    <Fragment>
      <TableRow>
        <TableCell>
          {quotes.length ? (
            <ExpandToggle open={open} onToggle={onToggle}>
              {category.category}
            </ExpandToggle>
          ) : (
            <span className="ps-6">{category.category}</span>
          )}
        </TableCell>
        <TableCell numeric>{formatCount(category.negative)}</TableCell>
        <TableCell numeric>{formatCount(category.positive)}</TableCell>
        <TableCell numeric>
          {share.kind === 'empty' ? (
            <Absence />
          ) : (
            <span className="inline-flex items-center gap-2">
              {share.small ? <Tag>{SMALL_SAMPLE}</Tag> : null}
              {share.text}
            </span>
          )}
        </TableCell>
        <TableCell>
          <PolaritySplit negative={category.negative} positive={category.positive} />
        </TableCell>
      </TableRow>
      {open && quotes.length ? <QuoteRows label={category.category} quotes={quotes} /> : null}
    </Fragment>
  );
}

function PolaritySplit({ negative, positive }: Readonly<{ negative: number; positive: number }>) {
  const total = negative + positive;
  if (!total) return null;
  return (
    <span aria-hidden className="flex h-1.5 w-40 gap-0.5">
      {negative ? (
        <span
          className="bg-negative rounded-full"
          style={{ width: `${(negative / total) * 100}%` }}
        />
      ) : null}
      {positive ? (
        <span
          className="bg-positive rounded-full"
          style={{ width: `${(positive / total) * 100}%` }}
        />
      ) : null}
    </span>
  );
}

const QUOTE_GRID =
  'grid grid-cols-[minmax(9rem,12rem)_minmax(16rem,1fr)_6rem_4rem_minmax(9rem,14rem)] gap-x-4';

const QUOTE_HEADS = ['Attribute', 'In the answer', 'Answer', 'Engine', 'Prompt'];

function QuoteRows({
  label,
  quotes,
}: Readonly<{ label: string; quotes: readonly { attribute: string; quote: PerceptionQuote }[] }>) {
  const span = useShownSpan(['attribute', 'negative', 'positive', 'share', 'split']);
  return (
    <TableRow>
      <TableCell nested colSpan={span} className="py-1">
        <div className="min-w-[48rem] whitespace-normal">
          <div aria-hidden className={cn(QUOTE_GRID, textRole('caption', 'text-ink-2 py-2'))}>
            {QUOTE_HEADS.map((head) => (
              <span key={head}>{head}</span>
            ))}
          </div>
          <ul aria-label={`${label} quotes`}>
            {quotes.map(({ attribute, quote }) => (
              <li
                key={`${quote.execution_id}:${quote.text}`}
                className={cn(QUOTE_GRID, 'border-rule items-start border-t py-3')}
              >
                <span>{attribute}</span>
                <span className="text-pretty">
                  <AnswerLink answer={quote} attributes>
                    “{quote.text}”
                  </AnswerLink>
                </span>
                <span>
                  <StatusMark variant="sentiment" value={quote.polarity}>
                    {quote.polarity === 'negative' ? 'Negative' : 'Positive'}
                  </StatusMark>
                </span>
                <EngineCell engine={quote.logical_engine} />
                <span>
                  <AnswerLink
                    answer={quote}
                    attributes
                    text="inherit"
                    tone="muted"
                    underline="hover"
                  >
                    {quote.prompt}
                  </AnswerLink>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </TableCell>
    </TableRow>
  );
}

function EngineCell({ engine }: Readonly<{ engine: string }>) {
  const label = useEngineCatalog().label(engine);
  const key = engineMarkKey(engine);
  if (!key) return <>{label}</>;
  return (
    <span title={label} className="inline-flex items-center">
      <EngineMark engine={key} placement="inline" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
