import { Card, CardContent } from '@/components/ui/card';
import { Inline, Stack } from '@/components/ui/layout';
import { TreeList, TreeOption } from '@/components/ui/list-row';
import { TextLink } from '@/components/ui/text-link';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps } from '@/components/ui/read-error';
import { textRole } from '@/components/ui/typography';
import type { CommerceCatalog } from '@citeladder/contracts/commerce-suite';
import { formatCount } from '@/lib/format';
import { nestedCategories } from '@/lib/products/category-tree';
import { targetHref } from '@/lib/products/targets';

import type { CommerceQueries } from './commerce-queries';

/**
 * The catalog's categories with their product counts, beside the Products
 * table: choosing one narrows the table to it, and the chosen category's own
 * page (its competitors and shopping prompts) opens from here. Categories
 * nest under their parents; a parent's count includes its children's products.
 */
export function CategorySidebar({
  query,
  category,
  onCategory,
}: Readonly<{
  query: CommerceQueries['catalog'];
  category: string | null;
  onCategory: (category: string | null) => void;
}>) {
  return (
    <Card className="min-w-0">
      <CardContent>
        <CategoryList query={query} category={category} onCategory={onCategory} />
      </CardContent>
    </Card>
  );
}

function CategoryList({
  query,
  category,
  onCategory,
}: Readonly<{
  query: CommerceQueries['catalog'];
  category: string | null;
  onCategory: (category: string | null) => void;
}>) {
  if (query.isPending) return <QueryState kind="loading" label="Loading categories" />;
  if (query.isError)
    return (
      <QueryState
        kind="error"
        {...readErrorProps(query)}
        fallback="Categories could not be loaded."
      />
    );
  const catalog: CommerceCatalog = query.data;
  const selected = catalog.categories.find((row) => row.id === category);
  return (
    <Stack gap="compact" className="min-w-0">
      <Inline className={textRole('label', 'justify-between')}>
        <span>Categories</span>
        <span className="tabular-nums">{formatCount(catalog.categories.length)}</span>
      </Inline>
      <TreeList label="Categories">
        <TreeOption
          label="All categories"
          count={formatCount(catalog.product_total)}
          selected={category === null}
          onSelect={() => onCategory(null)}
        />
        {nestedCategories(catalog.categories).map(({ category: row, depth }) => (
          <TreeOption
            key={row.id}
            label={row.name}
            count={formatCount(row.product_count)}
            selected={row.id === category}
            depth={depth}
            onSelect={() => onCategory(row.id)}
          />
        ))}
      </TreeList>
      {selected ? (
        <TextLink href={targetHref(selected.id)} text="caption">
          Open {selected.name}: its competitors and shopping prompts
        </TextLink>
      ) : null}
      {!catalog.categories.length ? (
        <span className="type-caption">No categories in the catalog yet.</span>
      ) : null}
    </Stack>
  );
}
