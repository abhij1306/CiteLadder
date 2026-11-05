import type { ReactNode } from 'react';

import { textRole } from '@/components/ui/typography';
import { ledgerClasses } from '@/components/ui/workspace';
import { cn } from '@/lib/utils';

/** One label and the value it names. `key` defaults to the label when that is text. */
export type Fact = Readonly<{ label: ReactNode; value: ReactNode; key?: string }>;

/**
 * How a list of facts lays out — a role, never a gap:
 *
 *   `ruled`  — the system's FactList, for detail panes: table-row-height rows divided by
 *              `line`, the labels in a fixed 160px `ink-secondary` column so
 *              every value starts at the same edge.
 *   `inline` — a record's summary facts on one wrapping line, each label
 *              beside its value (an Action's status, priority and target).
 *   `spread` — a short ledger read down the page, each label at the start and
 *              its value at the end (a quote's lines, an Action's evidence
 *              sources); `total` closes it under a rule.
 *   `columns` — a record's live status: one equal column per fact, the label
 *              over a one-line value at the badge height, so a value that
 *              changes (a sync's progress, a test result) swaps in place and
 *              never wraps or resizes the row. Long values truncate.
 */
export type FactLayout = 'ruled' | 'inline' | 'spread' | 'columns';

const LIST = {
  ruled: 'divide-line grid divide-y',
  inline: 'flex flex-wrap items-center gap-x-6 gap-y-3',
  spread: 'grid gap-2',
  columns: 'grid gap-3 desktop:grid-flow-col desktop:auto-cols-fr',
} as const;

const ROW = {
  // A fixed 160px label column, so every value starts at the same edge.
  ruled:
    'grid min-h-[var(--table-row-height)] grid-cols-[160px_minmax(0,1fr)] items-center gap-x-4 py-2',
  inline: 'flex items-center gap-2',
  spread: 'flex flex-wrap items-center justify-between gap-x-4 gap-y-1',
  columns: 'grid min-w-0 gap-1',
} as const;

const TERM = {
  ruled: 'text-body-sm text-ink-secondary',
  inline: textRole('label'),
  spread: textRole('body', 'text-ink-muted'),
  columns: textRole('label'),
} as const;

const DETAIL = {
  ruled: 'text-body-sm text-ink min-w-0 tabular-nums [overflow-wrap:anywhere]',
  inline: textRole('body'),
  // A spread row's value is a right-aligned amount or count (a quote line),
  // so its digits take the figure face and line up with the total under it.
  spread: textRole('body', 'text-ink font-mono'),
  columns: textRole(
    'caption',
    'flex h-[var(--badge-height-sm)] min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap tabular-nums',
  ),
} as const;

function factKey(fact: Fact, index: number) {
  if (fact.key) return fact.key;
  return typeof fact.label === 'string' ? fact.label : String(index);
}

export function FactList({
  facts,
  layout,
  total,
  label,
}: Readonly<{
  facts: readonly Fact[];
  layout: FactLayout;
  /** `spread` only: the closing line (a quote's total), under a rule. */
  total?: Fact;
  /** Names the list when nothing visible does. */
  label?: string;
}>) {
  return (
    <dl aria-label={label} data-fact-list={layout} className={LIST[layout]}>
      {facts.map((fact, index) => (
        <div key={factKey(fact, index)} className={ROW[layout]}>
          <dt className={TERM[layout]}>{fact.label}</dt>
          <dd className={DETAIL[layout]}>{fact.value}</dd>
        </div>
      ))}
      {total && layout === 'spread' ? (
        <div className={cn(ROW.spread, 'border-line border-t pt-2')}>
          <dt className={textRole('emphasis')}>{total.label}</dt>
          <dd className={textRole('emphasis', 'font-mono')}>{total.value}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/**
 * A ranked list of label/value rows at one row height, padded with empty rows
 * to `rows`, so a short list keeps the height of a full one and cards that
 * sit side by side end on one line.
 */
export function ValueLedger({
  items,
  rows,
}: Readonly<{
  items: ReadonlyArray<Readonly<{ key: string; label: ReactNode; value: ReactNode }>>;
  rows: number;
}>) {
  // Each empty slot is named by the row it fills, so it keeps its identity
  // while the list above it grows or shrinks.
  const padding = Array.from(
    { length: Math.max(0, rows - items.length) },
    (_, offset) => `slot-${items.length + offset}`,
  );
  return (
    <ol className={ledgerClasses('open')}>
      {items.map((item) => (
        <li
          key={item.key}
          className="flex h-[var(--control-md)] items-center justify-between gap-3"
        >
          <span className={textRole('body', 'min-w-0 truncate')}>{item.label}</span>
          <span className={textRole('label', 'shrink-0 font-mono')}>{item.value}</span>
        </li>
      ))}
      {padding.map((slot) => (
        <li key={slot} aria-hidden className="h-[var(--control-md)]" />
      ))}
    </ol>
  );
}
