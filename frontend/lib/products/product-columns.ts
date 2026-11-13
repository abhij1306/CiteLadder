import { useState } from 'react';

import type { CommerceProductRow } from '@citeladder/contracts/commerce-suite';

import { formatCount, formatPercent } from '@/lib/format';

/**
 * The Products table's metric columns, in order (the plan's "Metric
 * definitions", formula version 1). The product column is always shown; the
 * reader hides any of these from the column settings.
 */
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

/**
 * A cell's text, or the state that stands in for a missing value: no answer
 * in scope is `unavailable`, a price the catalog lacks is `unknown`. A real
 * zero is text ("0", "0%"), never a state. A note (quotes in other
 * currencies) can accompany either.
 */
export type ProductCell =
  | Readonly<{ kind: 'value'; text: string; note?: string }>
  | Readonly<{ kind: 'missing'; state: 'unavailable' | 'unknown' | 'none'; note?: string }>;

const missing = (state: 'unavailable' | 'unknown' | 'none', note?: string): ProductCell => ({
  kind: 'missing',
  state,
  ...(note ? { note } : {}),
});

/** A price in its currency when the code is a currency, else the bare amount. */
function formatPrice(amount: number, currency: string): string {
  if (/^[A-Z]{3}$/u.test(currency)) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
    } catch {
      // An unknown code falls through to the bare amount with its code.
    }
  }
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount);
  return currency ? `${number} ${currency}` : number;
}

/** A rate (visibility, win rate, share) as a percentage to one decimal. */
export const formatRate = (value: number) => formatPercent(value, 1);
/** A mean rank to one decimal. */
export const formatPosition = (value: number) => value.toFixed(1);

/** A rate or mean, unavailable when nothing in scope measured it. */
const measured = (value: number | null, format: (value: number) => string): ProductCell =>
  value === null ? missing('unavailable') : { kind: 'value', text: format(value) };

/**
 * The median quote in the row's currency; quotes in other currencies are
 * counted beside it, even when none was in its own currency.
 */
function mentionedPrice(row: CommerceProductRow): ProductCell {
  const { median, currency, other_currency } = row.mentioned_price;
  const note = other_currency ? `+${formatCount(other_currency)} in other currencies` : undefined;
  if (median === null) return missing('unavailable', note);
  return { kind: 'value', text: formatPrice(median, currency), ...(note ? { note } : {}) };
}

/** The catalog price or range; a competitor has none, a catalog product's is unknown. */
function catalogPrice(row: CommerceProductRow): ProductCell {
  const price = row.catalog_price;
  if (price === null) return missing(row.kind === 'owned' ? 'unknown' : 'none');
  const min = formatPrice(price.min, price.currency);
  if (price.min === price.max) return { kind: 'value', text: min };
  return { kind: 'value', text: `${min}–${formatPrice(price.max, price.currency)}` };
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
      return measured(row.visibility, formatRate);
    case 'appearances':
      return { kind: 'value', text: formatCount(row.appearances) };
    case 'win_rate':
      return measured(row.win_rate, formatRate);
    case 'position':
      return measured(row.position, formatPosition);
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

/** A holder's brand, when it has one, and what it is: "Acme · Competitor". */
export const holderCaption = (holder: Pick<CommerceProductRow, 'brand' | 'kind'>) =>
  [holder.brand, holderLabel(holder.kind)].filter(Boolean).join(' · ');

/**
 * A cell as CSV text: a missing value is empty rather than a word, and a note
 * (quotes in other currencies) follows the value in brackets.
 */
function csvText(cell: ProductCell): string {
  const text = cell.kind === 'value' ? cell.text : '';
  if (!cell.note) return text;
  return text ? `${text} (${cell.note})` : `(${cell.note})`;
}

/** The shown columns' headers and rows, for the export of the rows on screen. */
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
  } catch {
    // Unreadable storage keeps every column.
  }
  return [...ALL_KEYS];
}

/**
 * The shown metric columns, a reader preference kept per browser. Hiding a
 * column changes what is drawn and exported, never what is read.
 */
export function useProductColumns() {
  const [shown, setShown] = useState<ProductColumnKey[]>(storedColumns);
  const toggle = (key: ProductColumnKey) => {
    const next = shown.includes(key)
      ? shown.filter((value) => value !== key)
      : ALL_KEYS.filter((value) => value === key || shown.includes(value));
    setShown(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.filter(isColumnKey)));
    } catch {
      // A browser without storage keeps the choice for this visit.
    }
  };
  return { shown, toggle };
}
