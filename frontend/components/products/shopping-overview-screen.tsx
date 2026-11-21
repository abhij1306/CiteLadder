import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { ReportPage } from '@/components/templates/report-page';
import { Button } from '@/components/ui/button';
import { FilterBar } from '@/components/ui/filter-bar';
import { ProjectLink } from '@/components/ui/project-link';
import { AppGrid } from '@/components/ui/app-grid';
import { ClampText } from '@/components/ui/clamp-text';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DisplayTime } from '@/components/ui/display-time';
import { TableCell, TableCellLines, TableRow } from '@/components/ui/table';
import { SegmentedControl } from '@/components/ui/tabs';
import { TextLink } from '@/components/ui/text-link';
import { Absence } from '@/components/ui/absence';
import { Value } from '@/components/ui/value';
import { ProductName } from '@/components/products/products-table';
import type {
  CommerceOverviewBrand,
  CommerceOverviewProduct,
  CommerceShoppingOverview,
} from '@citeladder/contracts/commerce-suite';
import { ShoppingBag } from '@/lib/icons';
import { commerceQueries } from '@/lib/api/commerce';
import { PRODUCT_WINDOW_DAYS, type ProductWindowDays } from '@/lib/config/commerce';
import { categoryFilter, windowFilter } from './product-scope-filters';
import { formatCount, formatMean, pluralCount } from '@/lib/format';
import { formatRate } from '@/lib/products/product-columns';
import { targetHref } from '@/lib/products/targets';
import {
  overviewSearch,
  useOverviewFilters,
  type ProductScopeFilters,
} from '@/lib/products/product-filters';
import { stringUrlCodec, useUrlState } from '@/lib/navigation/url-state';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';
import { SectionContent, TitledSection } from '@/components/ui/section';
import { FigureStrip } from '@/components/ui/figure-strip';

const WIDEST_WINDOW = PRODUCT_WINDOW_DAYS.at(-1) ?? '90';

const RANKINGS = [
  { value: 'brands', label: 'Brands' },
  { value: 'products', label: 'Products' },
] as const;
type Ranking = (typeof RANKINGS)[number]['value'];
const rankingCodec = stringUrlCodec<Ranking>(
  RANKINGS.map((ranking) => ranking.value),
  'brands',
);
type Overview = CommerceShoppingOverview;

const emptyTable = (heading: string) => ({ kind: 'empty', icon: ShoppingBag, heading }) as const;

const VISIBILITY: DataTableColumn = {
  key: 'visibility',
  label: 'Visibility',
  hint: 'Share of answers in the window that named it.',
  kind: 'number',
};
const METRIC_COLUMNS: readonly DataTableColumn[] = [
  VISIBILITY,
  {
    key: 'win_rate',
    label: 'Win rate',
    hint: 'Of the ranked answers that named it, the share that ranked it first.',
    kind: 'number',
  },
  {
    key: 'position',
    label: 'Position',
    hint: 'Its mean rank in the answers that ranked it; a carousel rank counts first.',
    kind: 'number',
  },
];
const SHARE_COLUMN: DataTableColumn = {
  key: 'share_of_shelf',
  label: 'Share of shelf',
  hint: 'Its products’ share of every product recommendation in the answers.',
  kind: 'number',
  width: 'metric',
};

function Measured({
  value,
  format,
}: Readonly<{ value: number | null; format: (value: number) => string }>) {
  return <Value value={value === null ? null : format(value)} absent="unavailable" />;
}

function MetricCells({ row }: Readonly<{ row: CommerceOverviewProduct | CommerceOverviewBrand }>) {
  return (
    <>
      <TableCell>
        <Measured value={row.visibility} format={formatRate} />
      </TableCell>
      <TableCell>
        <Measured value={row.win_rate} format={formatRate} />
      </TableCell>
      <TableCell>
        <Measured value={row.position} format={formatMean} />
      </TableCell>
    </>
  );
}

function RankingTable({
  overview,
  scope,
}: Readonly<{
  overview: Overview;
  scope: ProductScopeFilters;
}>) {
  const [ranking, setRanking] = useUrlState('ranking', rankingCodec);
  const brands = ranking === 'brands';
  const count = brands ? overview.brands.length : overview.products.length;
  const empty = brands ? emptyTable('No brand ranked yet') : emptyTable('No product ranked yet');
  return (
    <DataTable
      title="Ranking"
      actions={
        <SegmentedControl
          ariaLabel="Ranking shown"
          value={ranking}
          options={RANKINGS}
          onChange={setRanking}
        />
      }
      columns={[
        { key: 'name', label: brands ? 'Brand' : 'Product', kind: 'identity' },
        ...METRIC_COLUMNS,
        ...(brands ? [SHARE_COLUMN] : []),
      ]}
      rowCount={count}
      state={count ? undefined : empty}
    >
      {brands
        ? overview.brands.map((row) => (
            <TableRow key={row.brand} highlight={row.owned}>
              <TableCell>
                <TableCellLines
                  title
                  primary={row.brand}
                  secondary={row.owned ? 'Your brand' : undefined}
                />
              </TableCell>
              <MetricCells row={row} />
              <TableCell>
                <Measured value={row.share_of_shelf} format={formatRate} />
              </TableCell>
            </TableRow>
          ))
        : overview.products.map((row) => (
            <TableRow key={row.holder_id} highlight={row.kind === 'owned'}>
              <TableCell>
                <ProductName row={row} scope={scope} />
              </TableCell>
              <MetricCells row={row} />
            </TableRow>
          ))}
    </DataTable>
  );
}

function ProductList({
  title,
  empty,
  rows,
  scope,
}: Readonly<{
  title: string;
  empty: string;
  rows: readonly CommerceOverviewProduct[];
  scope: ProductScopeFilters;
}>) {
  return (
    <DataTable
      title={title}
      columns={[
        { key: 'name', label: 'Product', kind: 'identity' },
        {
          key: 'appearances',
          label: 'Appearances',
          hint: 'Answers that named it.',
          kind: 'number',
        },
        VISIBILITY,
      ]}
      rowCount={rows.length}
      state={rows.length ? undefined : emptyTable(empty)}
    >
      {rows.map((row) => (
        <TableRow key={row.holder_id}>
          <TableCell>
            <ProductName row={row} scope={scope} />
          </TableCell>
          <TableCell>
            <Value value={formatCount(row.appearances)} />
          </TableCell>
          <TableCell>
            <Measured value={row.visibility} format={formatRate} />
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

function MerchantTable({ rows }: Readonly<{ rows: Overview['merchants'] }>) {
  return (
    <DataTable
      title="Top merchants"
      columns={[
        { key: 'domain', label: 'Merchant', kind: 'identity' },
        { key: 'answers', label: 'Answers', kind: 'number' },
        { key: 'products', label: 'Products', kind: 'number' },
      ]}
      rowCount={rows.length}
      state={rows.length ? undefined : emptyTable('No merchant yet')}
    >
      {rows.map((row) => (
        <TableRow key={row.domain}>
          <TableCell>
            <ClampText>{row.domain}</ClampText>
          </TableCell>
          <TableCell>
            <Value value={formatCount(row.answers)} />
          </TableCell>
          <TableCell>
            <Value value={formatCount(row.products)} />
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

function fanoutCoverage(fanout: Overview['fanout']) {
  const unknown = fanout.answers - fanout.answers_with_queries - fanout.answers_without_search;
  const parts = [
    pluralCount(fanout.answers, 'answer'),
    `${formatCount(fanout.answers_with_queries)} with queries`,
    `${formatCount(fanout.answers_without_search)} without a search`,
    ...(unknown ? [`${formatCount(unknown)} unknown`] : []),
  ];
  return parts.join(' · ');
}

function FanoutTable({ fanout }: Readonly<{ fanout: Overview['fanout'] }>) {
  const empty = emptyTable('No fan-out queries yet');
  return (
    <DataTable
      title="Top fan-out queries"
      description={fanout.answers ? fanoutCoverage(fanout) : undefined}
      columns={[
        { key: 'query', label: 'Query', kind: 'identity' },
        { key: 'answers', label: 'Answers', kind: 'number' },
      ]}
      rowCount={fanout.queries.length}
      state={fanout.queries.length ? undefined : empty}
    >
      {fanout.queries.map((row) => (
        <TableRow key={row.query}>
          <TableCell>
            <ClampText>{row.query}</ClampText>
          </TableCell>
          <TableCell>
            <Value value={formatCount(row.answers)} />
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

const shelfPercent = (value: number | null) => (value === null ? null : formatRate(value));

function CategoryShelf({
  shelf,
  categoryId,
}: Readonly<{ shelf: Overview['category_shelf']; categoryId: string }>) {
  const missing = shelf ? 'unavailable' : 'not_measured';
  const segments = [
    {
      label: 'Product visibility',
      value: shelfPercent(shelf?.product_visibility ?? null),
    },
    {
      label: 'Share of shelf',
      value: shelfPercent(shelf?.share_of_shelf ?? null),
    },
    {
      label: 'Average position',
      value:
        shelf?.average_shelf_position == null ? null : formatMean(shelf.average_shelf_position),
    },
    {
      label: 'First-position rate',
      value: shelfPercent(shelf?.first_position_win_rate ?? null),
    },
  ];
  return (
    <TitledSection
      title="Category shelf"
      description={
        shelf ? (
          <>
            <DisplayTime value={shelf.measured_at} dateOnly /> ·{' '}
            {pluralCount(shelf.successful_execution_count, 'answer')} ·{' '}
            {pluralCount(shelf.recognized_slot_count, 'recommendation')}
          </>
        ) : (
          <TextLink href={targetHref(categoryId)} text="inherit" underline="hover">
            Set up its shopping prompts
          </TextLink>
        )
      }
    >
      <SectionContent>
        <FigureStrip
          segments={segments.map(({ label, value }) => ({
            key: label,
            label,
            value: value ?? <Absence state={missing} />,
          }))}
        />
      </SectionContent>
    </TitledSection>
  );
}

export function OverviewSections({
  query,
  windowDays,
}: Readonly<{
  query: UseQueryResult<Overview>;
  windowDays: ProductWindowDays;
}>) {
  if (query.isPending)
    return (
      <StateBlock
        kind="loading"
        label="Loading the Shopping overview"
        shape={{ kind: 'figures', count: 2 }}
      />
    );
  if (query.isError)
    return (
      <StateBlock
        kind="error"
        {...readErrorProps(query)}
        title="Couldn't load the Shopping overview"
        fallback="The Shopping overview could not be loaded."
      />
    );
  const overview = query.data;
  const scope: ProductScopeFilters = { window: windowDays, engine: null, promptSet: null };
  const shelf = overview.category ? (
    <CategoryShelf shelf={overview.category_shelf} categoryId={overview.category} />
  ) : null;
  if (overview.executions === 0)
    return (
      <>
        {shelf}
        <StateBlock
          kind="empty"
          icon={ShoppingBag}
          heading={`No shopping answers in the last ${overview.window_days} days`}
          action={
            <Button asChild>
              <ProjectLink href="/products">Open Products</ProjectLink>
            </Button>
          }
        />
      </>
    );
  return (
    <>
      {shelf}
      <FigureStrip
        segments={[
          {
            key: 'answers',
            label: 'Answers',
            value: formatCount(overview.executions),
            sub: `In the last ${overview.window_days} days`,
          },
          {
            key: 'recommendations',
            label: 'Product recommendations',
            value: formatCount(overview.slots),
          },
        ]}
      />
      <RankingTable overview={overview} scope={scope} />
      <AppGrid layout="halves">
        <ProductList
          title="Most visible"
          empty="No product named yet"
          rows={overview.most_visible}
          scope={scope}
        />
        <ProductList
          title="Least visible"
          empty="Every product is listed under Most visible"
          rows={overview.least_visible}
          scope={scope}
        />
      </AppGrid>
      <AppGrid layout="halves">
        <MerchantTable rows={overview.merchants} />
        <FanoutTable fanout={overview.fanout} />
      </AppGrid>
    </>
  );
}

export function ShoppingOverviewScreen() {
  const { workspaceId, projectId } = useProjectScope();
  const scope = { workspaceId, projectId };
  const overviewFilters = useOverviewFilters();
  const { filters } = overviewFilters;
  const catalog = useQuery(commerceQueries.catalog(scope));
  const known = catalog.data?.categories ?? [];
  const category = known.some((row) => row.id === filters.category) ? filters.category : null;
  const query = useQuery({
    ...commerceQueries.overview(scope, overviewSearch({ ...filters, category })),
    enabled: !filters.category || !catalog.isPending,
  });
  const widest = useQuery({
    ...commerceQueries.overview(scope, overviewSearch({ window: WIDEST_WINDOW, category: null })),
    enabled: query.data?.executions === 0,
  });
  const neverAnswered = widest.data?.executions === 0;
  return (
    <ReportPage
      actions={
        query.data?.executions === 0 ? null : (
          <Button asChild variant="secondary">
            <ProjectLink href="/products">Open Products</ProjectLink>
          </Button>
        )
      }
      filters={
        neverAnswered ? undefined : (
          <FilterBar
            filters={[
              windowFilter(filters.window, overviewFilters.setWindow),
              categoryFilter(category, catalog.data, overviewFilters.setCategory),
            ]}
          />
        )
      }
    >
      <OverviewSections query={query} windowDays={filters.window} />
    </ReportPage>
  );
}
