import type { ReactNode } from 'react';

import { ClampText } from '@/components/ui/clamp-text';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses } from '@/components/ui/workspace';
import { cn } from '@/lib/utils';

export type Fact = Readonly<{
  label: ReactNode;
  value: ReactNode;
  key?: string;
  note?: ReactNode;
  end?: ReactNode;
}>;

export type FactLayout = 'ruled' | 'inline' | 'spread' | 'columns' | 'record';

const LIST = {
  ruled: 'divide-rule grid divide-y [:root:not([data-public-surface])_&]:not-data-ruled:divide-y-0',
  inline: 'flex flex-wrap items-center gap-x-6 gap-y-3',
  spread: 'grid gap-2',
  columns: 'grid gap-3 desktop:grid-flow-col desktop:auto-cols-fr',
  record: 'divide-rule grid min-w-0 divide-y',
} as const;

const ROW = {
  ruled:
    'grid min-h-[var(--table-row-height)] grid-cols-[160px_minmax(0,1fr)] items-center gap-x-4 py-2',
  inline: 'flex min-w-0 max-w-full items-center gap-2',
  spread: 'flex flex-wrap items-center justify-between gap-x-4 gap-y-1',
  columns: 'grid min-w-0 gap-1',
  record:
    'grid min-h-10 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-3 py-2 has-[[data-fact-note]]:min-h-14',
} as const;

const TERM = {
  ruled: 'text-body-sm text-ink-2',
  inline: textRole('body', 'text-ink-2 shrink-0'),
  spread: textRole('body', 'text-ink-2'),
  columns: textRole('body', 'text-ink-2'),
  record: textRole('body', 'text-ink min-w-0'),
} as const;

const DETAIL = {
  ruled: 'text-body-sm text-ink min-w-0 tabular-nums',
  inline: textRole('body', 'text-ink-2 min-w-0'),
  spread: textRole('body', 'text-ink tabular-nums'),
  columns: textRole(
    'caption',
    'flex min-h-[var(--tag-height)] min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap tabular-nums',
  ),
  record: 'flex min-w-0 items-center justify-between gap-3',
} as const;

const RULED_FROM = 4;

const ONE_LINE: Record<FactLayout, string | null> = {
  ruled:
    '[[data-public-surface]_&]:overflow-visible [[data-public-surface]_&]:whitespace-normal [[data-public-surface]_&]:[overflow-wrap:anywhere]',
  inline: 'min-w-0 truncate',
  spread: null,
  columns: 'min-w-0',
  record: null,
};

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
  total?: Fact;
  label?: string;
}>) {
  return (
    <dl
      aria-label={label}
      data-fact-list={layout}
      data-ruled={facts.length > RULED_FROM || undefined}
      className={cn('min-w-0', LIST[layout])}
    >
      {facts.map((fact, index) => (
        <div key={factKey(fact, index)} className={ROW[layout]}>
          <dt className={TERM[layout]}>{fact.label}</dt>
          <dd className={DETAIL[layout]}>
            <FactValue fact={fact} layout={layout} />
          </dd>
        </div>
      ))}
      {total && layout === 'spread' ? (
        <div className={cn(ROW.spread, 'border-rule border-t pt-2')}>
          <dt className={textRole('emphasis')}>{total.label}</dt>
          <dd className={textRole('emphasis', 'tabular-nums')}>{total.value}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function FactValue({ fact, layout }: Readonly<{ fact: Fact; layout: FactLayout }>) {
  if (layout === 'record') return <RecordValue fact={fact} />;
  const oneLine = ONE_LINE[layout];
  return oneLine ? <ClampText className={oneLine}>{fact.value}</ClampText> : fact.value;
}

function RecordValue({ fact }: Readonly<{ fact: Fact }>) {
  return (
    <>
      <span className="min-w-0">
        <span className={textRole('body', 'text-ink block tabular-nums')}>{fact.value}</span>
        {fact.note ? (
          <span data-fact-note="" className={textRole('caption', 'block')}>
            {fact.note}
          </span>
        ) : null}
      </span>
      {fact.end ? (
        <span className={textRole('body', 'shrink-0 text-right')}>{fact.end}</span>
      ) : null}
    </>
  );
}

export function ValueLedger({
  items,
  rows,
}: Readonly<{
  items: ReadonlyArray<Readonly<{ key: string; label: ReactNode; value: ReactNode }>>;
  rows: number;
}>) {
  const padding = Array.from(
    { length: Math.max(0, rows - items.length) },
    (_, offset) => `slot-${items.length + offset}`,
  );
  return (
    <ol className={ledgerClasses()}>
      {items.map((item) => (
        <li
          key={item.key}
          className="flex min-h-[var(--control-md)] items-center justify-between gap-2"
        >
          <ClampText className={textRole('body', 'flex-1')}>{item.label}</ClampText>
          <span className={textRole('body', 'text-ink-2 shrink-0 tabular-nums')}>{item.value}</span>
        </li>
      ))}
      {padding.map((slot) => (
        <li key={slot} aria-hidden className="h-[var(--control-md)]" />
      ))}
    </ol>
  );
}
