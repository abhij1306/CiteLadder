import type { ReactNode } from 'react';

import { textRole } from '@/components/ui/typography';
import { ledgerClasses } from '@/components/ui/workspace';
import { cn } from '@/lib/utils';

/** One label and the value it names. `key` defaults to the label when that is text. */
export type Fact = Readonly<{ label: ReactNode; value: ReactNode; key?: string }>;

/**
 * How a list of facts lays out — a role, never a gap:
 *
 *   `ruled`  — read-only settings facts: one ruled row per fact, the labels in
 *              a narrow column so every value starts at the same edge.
 *   `inline` — a record's summary facts on one wrapping line, each label
 *              beside its value (an Action's status, priority and target).
 *   `spread` — a short ledger read down the page, each label at the start and
 *              its value at the end (a quote's lines, an Action's evidence
 *              sources); `total` closes it under a rule.
 */
export type FactLayout = 'ruled' | 'inline' | 'spread';

const LIST = {
  ruled: 'divide-border-subtle grid divide-y',
  inline: 'flex flex-wrap items-center gap-x-6 gap-y-3',
  spread: 'grid gap-2',
} as const;

const ROW = {
  // Baseline-aligned, so a label sits on the line of a value drawn as chips.
  ruled:
    'grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-baseline gap-4 py-2 first:pt-0 last:pb-0',
  inline: 'flex items-center gap-2',
  spread: 'flex flex-wrap items-center justify-between gap-x-4 gap-y-1',
} as const;

const TERM = {
  ruled: textRole('label'),
  inline: textRole('label'),
  spread: textRole('body', 'text-muted'),
} as const;

const DETAIL = {
  ruled: textRole('body', 'text-foreground tabular-nums'),
  inline: textRole('body'),
  // A spread row's value is a right-aligned amount or count (a quote line),
  // so its digits take the figure face and line up with the total under it.
  spread: textRole('body', 'text-foreground font-numeric'),
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
        <div className={cn(ROW.spread, 'border-border border-t pt-2')}>
          <dt className={textRole('emphasis')}>{total.label}</dt>
          <dd className={textRole('emphasis', 'font-numeric')}>{total.value}</dd>
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
          className="flex h-[var(--control-height-md)] items-center justify-between gap-3"
        >
          <span className={textRole('body', 'min-w-0 truncate')}>{item.label}</span>
          <span className={textRole('label', 'shrink-0 font-numeric')}>{item.value}</span>
        </li>
      ))}
      {padding.map((slot) => (
        <li key={slot} aria-hidden className="h-[var(--control-height-md)]" />
      ))}
    </ol>
  );
}
