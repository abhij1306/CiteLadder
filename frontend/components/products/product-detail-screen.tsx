import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { NotFoundScreen } from '@/components/templates/not-found-screen';
import { RecordPage } from '@/components/templates/record-page';
import { FilterBar } from '@/components/ui/filter-bar';
import type { FilterDefinition } from '@/components/ui/all-filters';
import { InfoHint } from '@/components/ui/info-hint';
import { Inline, Stack } from '@/components/ui/layout';
import { ProductImage } from '@/components/ui/product-image';
import { UrlText } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import type { CommerceCatalog, CommerceProductDetail } from '@citeladder/contracts/commerce-suite';
import { MessageSquareOff } from '@/lib/icons';
import { commerceQueries } from '@/lib/api/commerce';
import { isNotFound } from '@/lib/api/errors';
import { promptsQueries } from '@/lib/api/prompts';
import { formatCount } from '@/lib/format';
import { useCompetitorDiscovery } from '@/lib/products/competitor-discovery';
import { holderCaption, PRODUCT_COLUMNS, productCell } from '@/lib/products/product-columns';
import {
  productScopeSearch,
  useProductScopeFilters,
  type ProductScopeFilters,
} from '@/lib/products/product-filters';
import { useCommerceQueries } from '@/lib/products/use-products-screen';
import { useEngineCatalog } from '@/lib/providers/engines';
import { useProjectScope } from '@/lib/project/active-project-scope';

import type { CommerceQueries } from './commerce-queries';
import { ProductActions } from './product-actions';
import { productScopeFilters } from './product-scope-filters';
import { AddToTracking, ProductCatalogControls } from './product-catalog-controls';
import {
  Answers,
  CompetingProducts,
  FanOutQueries,
  Merchants,
  PromptMetrics,
  SeenIn,
  Sources,
} from './product-sections';
import { MissingValue } from './products-table';
import { SetupCompetitors } from './setup-competitors';
import { SetupPrompts } from './setup-prompts';
import { readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';
import { Section, SectionHeader, SectionStack, SectionTitle } from '@/components/ui/section';
import { FigureStrip } from '@/components/ui/figure-strip';
import type { LoadingShape } from '@/components/ui/skeleton-block';

const PRODUCT_IDENTITY = { kind: 'facts', rows: 1 } satisfies LoadingShape;

const KPIS = [
  'visibility',
  'win_rate',
  'position',
  'appearances',
  'mentioned_price',
  'catalog_price',
] as const;

const trailFrom = (filters: ProductScopeFilters) => [
  { label: 'Products', href: `/products?${productScopeSearch(filters)}` },
];

export function ProductDetailScreen() {
  const { targetId = '' } = useParams();
  const { projectId } = useProjectScope();
  const scope = useProductScopeFilters();
  const queries = useCommerceQueries(projectId);
  const trail = trailFrom(scope.filters);
  const { catalog } = queries;
  if (catalog.isError)
    return (
      <RecordPage trail={trail}>
        <StateBlock
          kind="error"
          {...readErrorProps(catalog)}
          title="Couldn't load this product"
          fallback="This product could not be loaded."
        />
      </RecordPage>
    );
  if (!catalog.data)
    return (
      <RecordPage trail={trail}>
        <StateBlock kind="loading" label="Loading product" shape={PRODUCT_IDENTITY} />
      </RecordPage>
    );
  const category = catalog.data.categories.find((row) => row.id === targetId);
  if (category)
    return (
      <CategorySetup category={category} projectId={projectId} queries={queries} trail={trail} />
    );
  return (
    <HolderDetail
      key={targetId}
      holderId={targetId}
      projectId={projectId}
      queries={queries}
      scope={scope}
    />
  );
}

type Trail = ReturnType<typeof trailFrom>;

function CategorySetup({
  category,
  projectId,
  queries,
  trail,
}: Readonly<{
  category: CommerceCatalog['categories'][number];
  projectId: string;
  queries: CommerceQueries;
  trail: Trail;
}>) {
  const discovery = useCompetitorDiscovery(projectId);
  const target = { kind: 'category', id: category.id } as const;
  return (
    <RecordPage title={category.name} trail={trail}>
      <SetupCompetitors
        projectId={projectId}
        target={target}
        query={queries.competitors}
        discovery={discovery}
      />
      <SetupPrompts
        key={category.id}
        projectId={projectId}
        target={target}
        targetLabel={category.name}
        query={queries.buyerPrompts}
      />
    </RecordPage>
  );
}

function HolderDetail({
  holderId,
  projectId,
  queries,
  scope,
}: Readonly<{
  holderId: string;
  projectId: string;
  queries: CommerceQueries;
  scope: ReturnType<typeof useProductScopeFilters>;
}>) {
  const { workspaceId } = useProjectScope();
  const projectScope = { workspaceId, projectId };
  const scopeFilters = scope.filters;
  const detail = useQuery(
    commerceQueries.productDetail(projectScope, holderId, productScopeSearch(scopeFilters)),
  );
  const promptSets = useQuery(promptsQueries.sets(projectScope));
  const engines = useEngineCatalog();
  const filters: FilterDefinition[] = productScopeFilters({
    scope,
    engines,
    promptSets: promptSets.data?.prompt_sets ?? [],
  });
  const trail = trailFrom(scopeFilters);
  if (isNotFound(detail.error)) return <NotFoundScreen />;
  if (detail.isError)
    return (
      <RecordPage trail={trail}>
        <StateBlock
          kind="error"
          {...readErrorProps(detail)}
          title="Couldn't load this product"
          fallback="This product could not be loaded."
        />
      </RecordPage>
    );
  if (!detail.data)
    return (
      <RecordPage trail={trail}>
        <StateBlock kind="loading" label="Loading product" shape={PRODUCT_IDENTITY} />
      </RecordPage>
    );
  const data = detail.data;
  const named = data.answer_total > 0;
  const page = (notices: ReactNode, actions: ReactNode) => (
    <RecordPage
      title={data.product.name}
      trail={trail}
      busy={detail.isFetching}
      actions={actions}
      filters={<FilterBar filters={filters} />}
      identity={<ProductIdentity detail={data} notices={notices} />}
    >
      <ProductKpis detail={data} />
      {named ? (
        <>
          <CompetingProducts detail={data} scope={scopeFilters} />
          <Merchants detail={data} />
          <SeenIn detail={data} scope={scopeFilters} />
          <Sources detail={data} />
          <FanOutQueries detail={data} />
        </>
      ) : null}
      {named || data.prompts.length > 0 ? <PromptMetrics detail={data} /> : null}
      {named ? (
        <Answers detail={data} />
      ) : (
        <Section>
          <StateBlock
            kind="empty"
            icon={MessageSquareOff}
            heading={`No answer named it in the last ${data.window_days} days`}
          />
        </Section>
      )}
      {data.product.kind === 'owned' && data.product.catalog?.lifecycle_state !== 'archived' ? (
        <ProductSetup detail={data} projectId={projectId} queries={queries} />
      ) : null}
    </RecordPage>
  );
  const { product } = data;
  if (product.catalog)
    return (
      <ProductCatalogControls scope={projectScope} product={product} catalog={product.catalog}>
        {({ notices, actions }) => page(notices, actions)}
      </ProductCatalogControls>
    );
  return page(
    null,
    product.kind === 'ai_observed_competitor' ? (
      <AddToTracking scope={projectScope} candidateId={product.holder_id} name={product.name} />
    ) : null,
  );
}

function ProductIdentity({
  detail,
  notices,
}: Readonly<{ detail: CommerceProductDetail; notices: ReactNode }>) {
  const { product } = detail;
  const listingTitle =
    product.description && product.description.trim() !== product.name.trim()
      ? product.description
      : null;
  return (
    <Stack gap="workspace">
      <Inline gap="item">
        <InfoHint label="About this product">
          {holderCaption(product)} · From {formatCount(detail.executions)}
          {detail.executions === 1 ? ' answer' : ' answers'} in the last {detail.window_days} days.
          {listingTitle ? ` Listing title: ${listingTitle}` : null}
        </InfoHint>
        {product.image_url ? <ProductImage src={product.image_url} /> : null}
        {product.url ? (
          <TextLink
            variant="external"
            href={product.url}
            text="caption"
            className="flex max-w-full min-w-0"
          >
            {listingTitle ? <span className="sr-only">{listingTitle}, </span> : null}
            <UrlText url={product.url} />
          </TextLink>
        ) : (
          <span className="type-caption text-ink-2">{holderCaption(product)}</span>
        )}
      </Inline>
      {notices}
    </Stack>
  );
}

function ProductKpis({ detail }: Readonly<{ detail: CommerceProductDetail }>) {
  return (
    <FigureStrip
      label="Product metrics"
      segments={KPIS.map((key) => {
        const column = PRODUCT_COLUMNS.find((row) => row.key === key);
        const label = column?.label ?? key;
        const cell = productCell(detail.product, key);
        return {
          key,
          label,
          value: cell.kind === 'value' ? cell.text : <MissingValue cell={cell} />,
          sub: cell.note,
          marker: column ? <InfoHint label={`About ${label}`}>{column.hint}</InfoHint> : undefined,
        };
      })}
    />
  );
}

function ProductSetup({
  detail,
  projectId,
  queries,
}: Readonly<{ detail: CommerceProductDetail; projectId: string; queries: CommerceQueries }>) {
  const discovery = useCompetitorDiscovery(projectId);
  const target = { kind: 'product', id: detail.product.holder_id } as const;
  return (
    <Section aria-labelledby="product-setup">
      <SectionHeader>
        <SectionTitle id="product-setup">Setup</SectionTitle>
      </SectionHeader>
      <SectionStack>
        <ProductActions detail={detail} />
        <SetupCompetitors
          projectId={projectId}
          target={target}
          query={queries.competitors}
          discovery={discovery}
          level={3}
        />
        <SetupPrompts
          projectId={projectId}
          target={target}
          targetLabel={detail.product.name}
          query={queries.buyerPrompts}
          level={3}
        />
      </SectionStack>
    </Section>
  );
}
