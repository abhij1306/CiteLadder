import { useState } from 'react';

import type { CommerceProductRow } from '@citeladder/contracts/commerce-suite';

import { formatAmount, formatCount, formatMean, formatPercent } from '@/lib/format';

export const PRODUCT_COLUMNS = [
  {
    key: 'visibility',
    label: 'Visibility',
    hint: 'Share of answers in the window that named the product.',
  },
  { key: 'appearances', label: 'Appearances', hint: 'Answers that named the product.' },
  {
    key: 'win_rate',
    label: 'Win rate',
    hint: 'Of the ranked answers that named it, the share that ranked it first.',
  },
  {
    key: 'position',
    label: 'Position',
    hint: 'Its mean rank in the answers that ranked it; a carousel rank counts first.',
  },
  {
    key: 'mentioned_price',
    label: 'Mentioned price',
    hint: 'Median price the answers quoted; other currencies are counted, not converted.',
  },
  { key: 'catalog_price', label: 'Catalog price', hint: 'The price in your catalog.' },
  { key: 'merchants', label: 'Merchants', hint: 'Where the answers send shoppers to buy it.' },
] as const;

export type ProductColumnKey = (typeof PRODUCT_COLUMNS)[number]['key'];

export type ProductCell =
  | Readonly<{ kind: 'value'; text: string; note?: string }>
  | Readonly<{ kind: 'missing'; state: MissingState; note?: string }>;

type MissingState = 'unavailable' | 'unknown' | 'none' | 'not_mentioned' | 'not_applicable';

const missing = (state: MissingState, note?: string): ProductCell => ({
  kind: 'missing',
  state,
  ...(note ? { note } : {}),
});

export const formatRate = (value: number) => formatPercent(value);

const figureCell = (value: number | null, format: (value: number) => string): ProductCell =>
  value === null ? missing('unavailable') : { kind: 'value', text: format(value) };

function mentionedPrice(row: CommerceProductRow): ProductCell {
  const { median, currency, quoted, other_currency } = row.mentioned_price;
  const note = other_currency ? `+${formatCount(other_currency)} in other currencies` : undefined;
  if (median === null || quoted === 0)
    return missing(row.appearances && !other_currency ? 'not_mentioned' : 'unavailable', note);
  return { kind: 'value', text: formatAmount(median, currency), ...(note ? { note } : {}) };
}

function catalogPrice(row: CommerceProductRow): ProductCell {
  const price = row.catalog_price;
  if (price === null) return missing(row.kind === 'owned' ? 'unknown' : 'not_applicable');
  const min = formatAmount(price.min, price.currency);
  if (price.min === price.max) return { kind: 'value', text: min };
  return { kind: 'value', text: `${min}–${formatAmount(price.max, price.currency)}` };
}

function merchantList(row: CommerceProductRow): ProductCell {
  if (!row.merchants.length) return missing('none');
  const text = row.merchants
    .map((merchant) => `${merchant.domain} (${formatCount(merchant.count)})`)
    .join(', ');
  return { kind: 'value', text };
}

export function productCell(row: CommerceProductRow, key: ProductColumnKey): ProductCell {
  switch (key) {
    case 'visibility':
      return figureCell(row.visibility, formatRate);
    case 'appearances':
      return { kind: 'value', text: formatCount(row.appearances) };
    case 'win_rate':
      return figureCell(row.win_rate, formatRate);
    case 'position':
      return figureCell(row.position, formatMean);
    case 'mentioned_price':
      return mentionedPrice(row);
    case 'catalog_price':
      return catalogPrice(row);
    case 'merchants':
      return merchantList(row);
    default: {
      const exhaustive: never = key;
      return exhaustive;
    }
  }
}

const HOLDER_LABELS = {
  owned: 'Your product',
  approved_competitor: 'Competitor',
  ai_observed_competitor: 'Seen in answers',
} as const satisfies Record<CommerceProductRow['kind'], string>;

const holderLabel = (kind: CommerceProductRow['kind']) => HOLDER_LABELS[kind];

export const holderCaption = (holder: Pick<CommerceProductRow, 'brand' | 'kind'>) =>
  [holder.brand, holderLabel(holder.kind)].filter(Boolean).join(' · ');

function csvText(cell: ProductCell): string {
  const text = cell.kind === 'value' ? cell.text : '';
  if (!cell.note) return text;
  return text ? `${text} (${cell.note})` : `(${cell.note})`;
}

export function productCsv(
  rows: readonly CommerceProductRow[],
  columns: readonly ProductColumnKey[],
): { headers: string[]; rows: string[][] } {
  const shown = PRODUCT_COLUMNS.filter((column) => columns.includes(column.key));
  return {
    headers: ['Product', 'Brand', 'Holder', 'URL', ...shown.map((column) => column.label)],
    rows: rows.map((row) => [
      row.name,
      row.brand,
      holderLabel(row.kind),
      row.url,
      ...shown.map((column) => csvText(productCell(row, column.key))),
    ]),
  };
}

const STORAGE_KEY = 'citeladder:commerce:product-columns';
const ALL_KEYS = PRODUCT_COLUMNS.map((column) => column.key);
const KNOWN_KEYS: ReadonlySet<unknown> = new Set(ALL_KEYS);
const isColumnKey = (value: unknown): value is ProductColumnKey => KNOWN_KEYS.has(value);

function storedColumns(): ProductColumnKey[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(parsed)) return ALL_KEYS.filter((key) => parsed.includes(key));
  } catch {}
  return [...ALL_KEYS];
}

export function useProductColumns() {
  const [shown, setShown] = useState<ProductColumnKey[]>(storedColumns);
  const toggle = (key: ProductColumnKey) => {
    const next = shown.includes(key)
      ? shown.filter((value) => value !== key)
      : ALL_KEYS.filter((value) => value === key || shown.includes(value));
    setShown(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.filter(isColumnKey)));
    } catch {}
  };
  return { shown, toggle };
}
