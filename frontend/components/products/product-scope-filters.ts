import { choiceFilter, type FilterDefinition } from '@/components/ui/all-filters';
import {
  PRODUCT_DEFAULT_WINDOW,
  PRODUCT_WINDOW_DAYS,
  type ProductWindowDays,
} from '@/lib/config/commerce';
import type { useEngineCatalog } from '@/lib/providers/engines';

const EVERY = '__all__';

/** The reporting window every product page reads. */
export function windowFilter(
  value: ProductWindowDays,
  onChange: (value: ProductWindowDays) => void,
): FilterDefinition {
  return choiceFilter({
    id: 'window',
    label: 'Window',
    value,
    defaultValue: PRODUCT_DEFAULT_WINDOW,
    groups: [
      { options: PRODUCT_WINDOW_DAYS.map((days) => ({ value: days, label: `Last ${days} days` })) },
    ],
    onChange,
  });
}

/** One optional id among named options, "All …" when none. */
function everyFilter({
  id,
  label,
  allLabel,
  value,
  options,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  allLabel: string;
  value: string | null;
  options: readonly { value: string; label: string }[];
  onChange: (value: string | null) => void;
}>): FilterDefinition {
  return choiceFilter({
    id,
    label,
    value: value ?? EVERY,
    defaultValue: EVERY,
    groups: [{ options: [{ value: EVERY, label: allLabel }, ...options] }],
    onChange: (next) => onChange(next === EVERY ? null : next),
  });
}

/**
 * The scope every product page filters by, in All filters: the window, the
 * engine and the prompt set the answers came from.
 */
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
    everyFilter({
      id: 'engine',
      label: 'Engine',
      allLabel: 'All engines',
      value: scope.filters.engine,
      options: engines.order.map((key) => ({ value: key, label: engines.label(key) })),
      onChange: scope.setEngine,
    }),
    everyFilter({
      id: 'prompt-set',
      label: 'Prompt set',
      allLabel: 'All prompt sets',
      value: scope.filters.promptSet,
      options: promptSets.map((set) => ({ value: set.id, label: set.name })),
      onChange: scope.setPromptSet,
    }),
  ];
}

/** The catalog category a page narrows to. */
export function categoryFilter(
  value: string | null,
  categories: readonly { id: string; name: string }[],
  onChange: (value: string | null) => void,
): FilterDefinition {
  return everyFilter({
    id: 'category',
    label: 'Category',
    allLabel: 'All categories',
    value,
    options: categories.map((row) => ({ value: row.id, label: row.name })),
    onChange,
  });
}
