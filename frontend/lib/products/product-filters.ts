import {
  commerceProductSortSchema,
  commerceProductSourceSchema,
  type CommerceProductSort,
  type CommerceProductSource,
} from '@citeladder/contracts/commerce-suite';

import {
  PRODUCT_DEFAULT_WINDOW,
  PRODUCT_WINDOW_DAYS,
  type ProductWindowDays,
} from '@/lib/config/commerce';
import { TABLE_DEFAULT_PAGE_SIZE, type TablePageSize } from '@/lib/config/tables';
import { optionalStringUrlCodec, stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';

export type ProductFilters = Readonly<{
  source: CommerceProductSource;
  category: string | null;
  window: ProductWindowDays;
  engine: string | null;
  promptSet: string | null;
  q: string;
  sort: CommerceProductSort;
}>;

const SOURCE_CODEC = stringUrlCodec(commerceProductSourceSchema.options, 'catalog');
const SORT_CODEC = stringUrlCodec(commerceProductSortSchema.options, 'visibility');
const WINDOW_CODEC = stringUrlCodec(PRODUCT_WINDOW_DAYS, PRODUCT_DEFAULT_WINDOW);

export const DEFAULT_PRODUCT_FILTERS: ProductFilters = {
  source: 'catalog',
  category: null,
  window: PRODUCT_DEFAULT_WINDOW,
  engine: null,
  promptSet: null,
  q: '',
  sort: 'visibility',
};

export function productSearch(
  filters: ProductFilters,
  pageSize: TablePageSize = TABLE_DEFAULT_PAGE_SIZE,
): string {
  const params = new URLSearchParams({
    source: filters.source,
    window: filters.window,
    sort: filters.sort,
    limit: String(pageSize),
  });
  if (filters.category) params.set('category', filters.category);
  if (filters.engine) params.set('engine', filters.engine);
  if (filters.promptSet) params.set('prompt_set', filters.promptSet);
  const q = filters.q.trim();
  if (q) params.set('q', q);
  return params.toString();
}

export type OverviewFilters = Readonly<{ category: string | null; window: ProductWindowDays }>;

export const DEFAULT_OVERVIEW_FILTERS: OverviewFilters = {
  category: null,
  window: PRODUCT_DEFAULT_WINDOW,
};

export function overviewSearch(filters: OverviewFilters): string {
  const params = new URLSearchParams({ window: filters.window });
  if (filters.category) params.set('category', filters.category);
  return params.toString();
}

export function useOverviewFilters() {
  const [category, setCategory] = useUrlState('category', optionalStringUrlCodec);
  const [windowDays, setWindow] = useUrlState('window', WINDOW_CODEC);
  const filters: OverviewFilters = { category, window: windowDays };
  return { filters, setCategory, setWindow };
}

export type ProductScopeFilters = Pick<ProductFilters, 'window' | 'engine' | 'promptSet'>;

export function productScopeSearch(filters: ProductScopeFilters): string {
  const params = new URLSearchParams({ window: filters.window });
  if (filters.engine) params.set('engine', filters.engine);
  if (filters.promptSet) params.set('prompt_set', filters.promptSet);
  return params.toString();
}

export function productHref(holderId: string, filters: ProductScopeFilters): string {
  return `/products/${holderId}?${productScopeSearch(filters)}`;
}

export function useProductScopeFilters() {
  const [windowDays, setWindow] = useUrlState('window', WINDOW_CODEC);
  const [engine, setEngine] = useUrlState('engine', optionalStringUrlCodec);
  const [promptSet, setPromptSet] = useUrlState('prompt_set', optionalStringUrlCodec);
  const filters: ProductScopeFilters = { window: windowDays, engine, promptSet };
  return { filters, setWindow, setEngine, setPromptSet };
}

export function useProductFilters() {
  const [source, setSource] = useUrlState('source', SOURCE_CODEC);
  const [category, setCategory] = useUrlState('category', optionalStringUrlCodec);
  const [windowDays, setWindow] = useUrlState('window', WINDOW_CODEC);
  const [engine, setEngine] = useUrlState('engine', optionalStringUrlCodec);
  const [promptSet, setPromptSet] = useUrlState('prompt_set', optionalStringUrlCodec);
  const [q, setQ] = useUrlState('q', optionalStringUrlCodec, { history: 'replace' });
  const [sort, setSort] = useUrlState('sort', SORT_CODEC);
  const filters: ProductFilters = {
    source,
    category,
    window: windowDays,
    engine,
    promptSet,
    q: q ?? '',
    sort,
  };
  return {
    filters,
    setSource,
    setCategory,
    setWindow,
    setEngine,
    setPromptSet,
    setQ: (value: string) => setQ(value || null),
    setSort,
  };
}
