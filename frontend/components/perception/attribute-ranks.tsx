import { useState } from 'react';
import type { PerceptionResponse } from '@citeladder/contracts/visibility-perception';

import { IconButton } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { SegmentedControl } from '@/components/ui/tabs';
import { textRole } from '@/components/ui/typography';
import { Maximize2, Minimize2 } from '@/lib/icons';
import { formatCount } from '@/lib/format';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { rankCategories, type Polarity } from '@/lib/visibility/perception';
import { cn } from '@/lib/utils';

type Category = PerceptionResponse['entities'][number]['categories'][number];

const SHOWN = 9;

const ORDERS = ['negative', 'positive'] satisfies Polarity[];

const ORDER_CODEC = stringUrlCodec<Polarity>(ORDERS, 'negative');

const ORDER_LABEL: Record<Polarity, string> = {
  negative: 'Most negative',
  positive: 'Most positive',
};

const DOT: Record<Polarity, string> = { negative: 'bg-negative', positive: 'bg-positive' };

export function AttributeRanks({ categories }: Readonly<{ categories: readonly Category[] }>) {
  const [requested, setOrder] = useUrlState('rank', ORDER_CODEC, { history: 'replace' });
  const [all, setAll] = useState(false);
  const ranks = {
    negative: rankCategories(categories, 'negative'),
    positive: rankCategories(categories, 'positive'),
  };
  const orders = ORDERS.filter((order) => ranks[order].length > 0);
  const order = orders.includes(requested) ? requested : orders[0];
  if (!order) return null;
  const ranked = ranks[order];
  const shown = all ? ranked : ranked.slice(0, SHOWN);
  const most = ranked[0]?.[order] ?? 1;
  return (
    <Card aria-label="Ranked attributes" className="flex min-w-0 flex-col">
      <CardHeader
        className="flex-row items-center"
        actions={<span className={textRole('caption', 'text-ink-2')}>Points</span>}
      >
        <span className="flex items-center gap-2">
          <SegmentedControl
            value={order}
            onChange={setOrder}
            ariaLabel="Order attributes"
            options={orders.map((value) => ({ value, label: ORDER_LABEL[value] }))}
          />
          <InfoHint label="About attributes">Labelled points per category</InfoHint>
        </span>
      </CardHeader>
      <ol className="grid gap-1">
        {shown.map((category) => (
          <li
            key={category.category}
            className="grid h-8 grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-3"
          >
            <span className="min-w-0">
              <span
                className="bg-raised-2 rounded-mark flex h-7 min-w-max items-center gap-2 px-2.5"
                style={{ width: `${Math.max((category[order] / most) * 100, 8)}%` }}
              >
                <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT[order])} />
                <span className={textRole('body', 'whitespace-nowrap')}>{category.category}</span>
              </span>
            </span>
            <span className={textRole('body', 'text-right tabular-nums')}>
              {formatCount(category[order])}
            </span>
          </li>
        ))}
      </ol>
      {ranked.length > SHOWN ? (
        <span className="flex justify-center pt-2">
          <IconButton
            icon={all ? Minimize2 : Maximize2}
            label={all ? 'Show fewer' : `Show all ${ranked.length}`}
            onClick={() => setAll(!all)}
          />
        </span>
      ) : null}
    </Card>
  );
}
