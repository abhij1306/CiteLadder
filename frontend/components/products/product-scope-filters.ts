import { rangeFilter, singleFilter, type FilterDefinition } from '@/components/ui/all-filters';
import {
  PRODUCT_DEFAULT_WINDOW,
  PRODUCT_WINDOW_DAYS,
  type ProductWindowDays,
} from '@/lib/config/commerce';
import { formatCount } from '@/lib/format';
import { nestedCategories } from '@/lib/products/category-tree';
import type { useEngineCatalog } from '@/lib/providers/engines';
import type { CommerceCatalog } from '@citeladder/contracts/commerce-suite';

export function windowFilter(
  value: ProductWindowDays,
  onChange: (value: ProductWindowDays) => void,
): FilterDefinition {
  return rangeFilter({
    value,
    defaultValue: PRODUCT_DEFAULT_WINDOW,
    options: PRODUCT_WINDOW_DAYS.map((days) => ({ value: days, label: `Last ${days} days` })),
    onChange,
  });
}

export function productScopeFilters({
  scope,
  engines,
  promptSets,
}: Readonly<{
  scope: Readonly<{
    filters: Readonly<{
      window: ProductWindowDays;
      engine: string | null;
      promptSet: string | null;
    }>;
    setWindow: (value: ProductWindowDays) => void;
    setEngine: (value: string | null) => void;
    setPromptSet: (value: string | null) => void;
  }>;
  engines: ReturnType<typeof useEngineCatalog>;
  promptSets: readonly { id: string; name: string }[];
}>): FilterDefinition[] {
  return [
    windowFilter(scope.filters.window, scope.setWindow),
    singleFilter({
      id: 'engine',
      label: 'Engine',
      allLabel: 'All engines',
      value: scope.filters.engine,
      options: engines.order.map((key) => ({ value: key, label: engines.label(key) })),
      onChange: scope.setEngine,
    }),
    singleFilter({
      id: 'prompt-set',
      label: 'Prompt set',
      allLabel: 'All prompt sets',
      value: scope.filters.promptSet,
      options: promptSets.map((set) => ({ value: set.id, label: set.name })),
      onChange: scope.setPromptSet,
    }),
  ];
}

export function categoryFilter(
  value: string | null,
  catalog: Pick<CommerceCatalog, 'categories' | 'product_total'> | undefined,
  onChange: (value: string | null) => void,
): FilterDefinition {
  const categories = catalog?.categories ?? [];
  const names = new Map(categories.map((row) => [row.id, row.name]));
  const parents = new Map(categories.map((row) => [row.id, row.parent_id]));
  const path = (id: string) => {
    const chain: string[] = [];
    let at: string | null | undefined = id;
    while (at && names.has(at) && !chain.includes(at)) {
      chain.unshift(at);
      at = parents.get(at);
    }
    return chain.map((row) => names.get(row)).join(' › ');
  };
  return singleFilter({
    id: 'category',
    label: 'Category',
    allLabel: catalog ? `All categories · ${formatCount(catalog.product_total)}` : 'All categories',
    value,
    options: nestedCategories(categories).map(({ category }) => ({
      value: category.id,
      label: `${path(category.id)} · ${formatCount(category.product_count)}`,
    })),
    onChange,
  });
}
