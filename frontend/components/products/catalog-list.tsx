'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, PackageOpen, SearchX } from 'lucide-react';

import { IconButton } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Inline, Stack } from '@/components/ui/layout';
import { listRowClasses } from '@/components/ui/list-row';
import { panelClasses } from '@/components/ui/panel';
import { treeBranchClasses } from '@/components/ui/workspace';
import { SearchField } from '@/components/ui/search-field';
import { Pressable } from '@/components/ui/pressable';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps } from '@/components/ui/read-error';
import type { CommerceTarget } from '@citeladder/contracts/commerce-suite';
import { targetKey } from '@/lib/products/use-commerce-target';
import { cn } from '@/lib/utils';

import type { CommerceQueries } from './commerce-queries';
import { textRole } from '@/components/ui/typography';

export type CatalogEntry = {
  key: string;
  label: string;
  target: CommerceTarget;
  /** Products in a category; undefined for a product row. */
  count?: number;
  categoryIds?: string[];
  children?: CatalogEntry[];
};

export function catalogEntries(query: CommerceQueries['catalog']): {
  categories: CatalogEntry[];
  products: CatalogEntry[];
} {
  const data = query.data;
  if (!data) return { categories: [], products: [] };
  const products = data.products.map((row) => ({
    key: targetKey({ kind: 'product', id: row.id }),
    label: row.name || row.canonical_url,
    target: { kind: 'product' as const, id: row.id },
    categoryIds: row.category_ids,
  }));
  return {
    categories: data.categories.map((row) => ({
      key: targetKey({ kind: 'category', id: row.id }),
      label: row.name,
      target: { kind: 'category' as const, id: row.id },
      count: row.product_count,
      children: products.filter((product) => product.categoryIds?.includes(row.id)),
    })),
    products,
  };
}

function matches(entry: CatalogEntry, needle: string): boolean {
  return !needle || entry.label.toLowerCase().includes(needle);
}

function checkboxState(selectedCount: number, totalCount: number): boolean | 'indeterminate' {
  if (selectedCount === 0) return false;
  return selectedCount === totalCount ? true : 'indeterminate';
}

function shownTargetKeys(categories: CatalogEntry[], uncategorized: CatalogEntry[]): string[] {
  return [
    ...new Set([
      ...categories.flatMap((category) => [
        category.key,
        ...(category.children ?? []).map((child) => child.key),
      ]),
      ...uncategorized.map((product) => product.key),
    ]),
  ];
}

function CatalogRow({
  entry,
  selected,
  checked,
  partiallyChecked = false,
  nested = false,
  expanded,
  onExpand,
  onSelect,
  onToggle,
  children,
}: Readonly<{
  entry: CatalogEntry;
  selected: boolean;
  checked: boolean;
  partiallyChecked?: boolean;
  nested?: boolean;
  expanded?: boolean;
  onExpand?: () => void;
  onSelect: () => void;
  onToggle: () => void;
  children?: ReactNode;
}>) {
  return (
    <li className="min-w-0">
      {/* The row is the picker. A checkbox in the gutter is bulk selection and
          deliberately does NOT change which target is open, so checking three
          categories to run them together never moves you off the one you are
          reading. */}
      {/* A top-level row reserves the expander's column even without
          children, so its label lines up with its expandable siblings; a
          nested row hangs off its branch's rule and has no expander. */}
      <Stack
        gap="tight"
        className={cn(
          'group items-center',
          nested
            ? 'grid-cols-[auto_minmax(0,1fr)]'
            : 'grid-cols-[var(--control-height-md)_auto_minmax(0,1fr)]',
          listRowClasses({ selected }),
        )}
      >
        {onExpand ? (
          <IconButton
            icon={expanded ? ChevronDown : ChevronRight}
            label={`${expanded ? 'Collapse' : 'Expand'} ${entry.label}`}
            aria-expanded={expanded}
            onClick={onExpand}
          />
        ) : (
          !nested && <span aria-hidden />
        )}
        <Checkbox
          aria-label={`Select ${entry.label} for bulk actions`}
          checked={partiallyChecked ? 'indeterminate' : checked}
          onCheckedChange={onToggle}
        />
        <Pressable
          type="button"
          onClick={onSelect}
          aria-label={entry.label}
          aria-current={selected ? 'true' : undefined}
          className="type-control flex min-h-[var(--control-height-md)] min-w-0 items-center text-left"
        >
          <Inline as="span" className="w-full justify-between">
            <span className="truncate">{entry.label}</span>
            {entry.count === undefined ? null : (
              <span className="text-muted shrink-0 tabular-nums">{entry.count}</span>
            )}
          </Inline>
        </Pressable>
      </Stack>
      {children}
    </li>
  );
}

function CatalogTree({
  categories,
  uncategorized,
  selectedKey,
  checkedKeys,
  onSelect,
  onToggle,
  searching,
}: Readonly<{
  categories: CatalogEntry[];
  uncategorized: CatalogEntry[];
  selectedKey?: string;
  checkedKeys: Set<string>;
  onSelect: (target: CommerceTarget) => void;
  onToggle: (keys: string[]) => void;
  searching: boolean;
}>) {
  const [expandedByKey, setExpandedByKey] = useState<Record<string, boolean>>({});
  if (!categories.length && !uncategorized.length) return null;
  const shownKeys = shownTargetKeys(categories, uncategorized);
  const shownSelectionCount = shownKeys.filter((key) => checkedKeys.has(key)).length;
  return (
    <Stack as="fieldset" className="min-w-0">
      <legend className="sr-only">Catalog targets</legend>
      <Inline gap="compact" className={panelClasses({ tone: 'tonal' }, 'justify-between')}>
        <Checkbox
          label="Select all shown"
          checked={checkboxState(shownSelectionCount, shownKeys.length)}
          onCheckedChange={() => onToggle(shownKeys)}
        />
        <span className="type-caption tabular-nums">{shownKeys.length} shown</span>
      </Inline>
      <Inline className={textRole('label', 'justify-between')}>
        <span>Categories</span>
        <span className="tabular-nums">{categories.length}</span>
      </Inline>
      <Stack as="ul" gap="tight" className="min-w-0">
        {categories.map((category) => {
          const selectionKeys = [
            category.key,
            ...(category.children ?? []).map((child) => child.key),
          ];
          const selectedCount = selectionKeys.filter((key) => checkedKeys.has(key)).length;
          const hasProducts = Boolean(category.children?.length);
          // A deep-linked product opens its category so the selection is visible.
          const holdsSelection = (category.children ?? []).some(
            (child) => child.key === selectedKey,
          );
          const expanded =
            hasProducts && (expandedByKey[category.key] ?? (searching || holdsSelection));
          return (
            <CatalogRow
              key={category.key}
              entry={category}
              selected={category.key === selectedKey}
              checked={selectedCount === selectionKeys.length}
              partiallyChecked={selectedCount > 0 && selectedCount < selectionKeys.length}
              expanded={expanded}
              onExpand={
                hasProducts
                  ? () =>
                      setExpandedByKey((current) => ({
                        ...current,
                        [category.key]: !expanded,
                      }))
                  : undefined
              }
              onSelect={() => onSelect(category.target)}
              onToggle={() => onToggle(selectionKeys)}
            >
              {expanded ? (
                <ul aria-label={`${category.label} products`} className={treeBranchClasses()}>
                  {(category.children ?? []).map((product) => (
                    <CatalogRow
                      key={`${category.key}:${product.key}`}
                      entry={product}
                      selected={product.key === selectedKey}
                      checked={checkedKeys.has(product.key)}
                      nested
                      onSelect={() => onSelect(product.target)}
                      onToggle={() => onToggle([product.key])}
                    />
                  ))}
                </ul>
              ) : null}
            </CatalogRow>
          );
        })}
      </Stack>
      {uncategorized.length ? (
        <Stack gap="tight" className="min-w-0">
          <div className={textRole('label')}>Uncategorized</div>
          <ul className={treeBranchClasses()}>
            {uncategorized.map((product) => (
              <CatalogRow
                key={product.key}
                entry={product}
                selected={product.key === selectedKey}
                checked={checkedKeys.has(product.key)}
                nested
                onSelect={() => onSelect(product.target)}
                onToggle={() => onToggle([product.key])}
              />
            ))}
          </ul>
        </Stack>
      ) : null}
    </Stack>
  );
}

/**
 * Crawled pages project into the catalog only for a business that sells one,
 * so a crawl is advice only there; any business can import a CSV.
 */
function emptyCatalogHint(crawlProjects: boolean | undefined): string {
  return crawlProjects
    ? 'Run a Site Health crawl or import a CSV.'
    : 'Crawled pages become catalog products only for businesses that sell a product catalog. Import a CSV to add products.';
}

function filteredCatalog(
  categories: CatalogEntry[],
  products: CatalogEntry[],
  needle: string,
): { categories: CatalogEntry[]; uncategorized: CatalogEntry[] } {
  const knownCategoryIds = new Set(categories.map((entry) => entry.target.id));
  const visibleCategories = categories.flatMap((category) => {
    const categoryMatches = matches(category, needle);
    const children = (category.children ?? []).filter(
      (product) => categoryMatches || matches(product, needle),
    );
    return categoryMatches || children.length ? [{ ...category, children }] : [];
  });
  const uncategorized = products.filter(
    (product) =>
      !(product.categoryIds ?? []).some((categoryId) => knownCategoryIds.has(categoryId)) &&
      matches(product, needle),
  );
  return { categories: visibleCategories, uncategorized };
}

/**
 * The catalog as navigation.
 *
 * Selecting a category or product happens here, once, by clicking the list you
 * are already reading — replacing the target selector that each tab used to
 * carry its own copy of.
 */
export function CatalogList({
  query,
  selectedKey,
  checkedKeys,
  onSelect,
  onToggle,
}: Readonly<{
  query: CommerceQueries['catalog'];
  selectedKey?: string;
  checkedKeys: Set<string>;
  onSelect: (target: CommerceTarget) => void;
  onToggle: (keys: string[]) => void;
}>) {
  const [search, setSearch] = useState('');
  const { categories, products } = useMemo(() => catalogEntries(query), [query]);
  const needle = search.trim().toLowerCase();
  const shown = filteredCatalog(categories, products, needle);
  const empty = !shown.categories.length && !shown.uncategorized.length;

  if (query.isPending) return <QueryState kind="loading" label="Loading the catalog…" />;
  if (query.isError)
    return (
      <QueryState
        kind="error"
        {...readErrorProps(query)}
        fallback="The catalog could not be loaded."
      />
    );
  return (
    <Stack className="min-w-0 content-start">
      <Stack className="bg-panel sticky top-0 z-20">
        <SearchField
          aria-label="Search the catalog"
          placeholder="Search categories and products"
          value={search}
          onValueChange={setSearch}
        />
        <p className="type-caption">
          Check items for bulk actions. Select a name to view its details.
        </p>
      </Stack>
      <Stack className="min-w-0">
        {empty ? (
          <QueryState
            kind="empty"
            icon={needle ? SearchX : PackageOpen}
            headingLevel={3}
            heading={needle ? `Nothing matches “${search.trim()}”.` : 'Nothing projected yet.'}
            description={needle ? undefined : emptyCatalogHint(query.data?.projection.applies)}
          />
        ) : (
          <CatalogTree
            categories={shown.categories}
            uncategorized={shown.uncategorized}
            selectedKey={selectedKey}
            checkedKeys={checkedKeys}
            onSelect={onSelect}
            onToggle={onToggle}
            searching={Boolean(needle)}
          />
        )}
      </Stack>
    </Stack>
  );
}
