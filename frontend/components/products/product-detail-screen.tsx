import { useQuery } from '@tanstack/react-query';
import { MessageSquareOff } from 'lucide-react';
import { useParams } from 'react-router-dom';

import { DetailScreen } from '@/components/layout/page-shell';
import { AppGrid } from '@/components/ui/app-grid';
import { Card } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { Inline, Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { readErrorProps } from '@/components/ui/read-error';
import { ProductImage } from '@/components/ui/product-image';
import { KpiRow } from '@/components/ui/stat-row';
import { TextLink } from '@/components/ui/text-link';
import { InlineFigure, textRole } from '@/components/ui/typography';
import type { CommerceCatalog, CommerceProductDetail } from '@citeladder/contracts/commerce-suite';
import { commerceQueries } from '@/lib/api/commerce';
import type { ProjectScope } from '@/lib/api/query-keys/scope';
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
  Sources,
} from './product-sections';
import { MetricValue } from './products-table';
import { SetupCompetitors } from './setup-competitors';
import { SetupPrompts } from './setup-prompts';

/** The KPIs, in the plan's order; merchants have their own section below. */
const KPIS = [
  'visibility',
  'win_rate',
  'position',
  'appearances',
  'mentioned_price',
  'catalog_price',
] as const;

const backTo = (filters: ProductScopeFilters) =>
  ({ href: `/products?${productScopeSearch(filters)}`, label: 'Back to Products' }) as const;

/**
 * `/products/:id`: a product holder's page (commerce improvement PR 4), or a
 * category's setup. Products and categories share the path, so an id the
 * catalog lists as a category opens its competitors and shopping prompts;
 * any other id is a product holder, which the detail read finds or refuses.
 */
export function ProductDetailScreen() {
  const { targetId = '' } = useParams();
  const { projectId } = useProjectScope();
  const scope = useProductScopeFilters();
  const queries = useCommerceQueries(projectId);
  const back = backTo(scope.filters);
  const { catalog } = queries;
  if (catalog.isError)
    return (
      <DetailScreen back={back}>
        <QueryState
          kind="error"
          {...readErrorProps(catalog)}
          fallback="This product could not be loaded."
        />
      </DetailScreen>
    );
  if (!catalog.data)
    return (
      <DetailScreen back={back}>
        <QueryState kind="loading" label="Loading product" />
      </DetailScreen>
    );
  const category = catalog.data.categories.find((row) => row.id === targetId);
  if (category)
    return (
      <CategorySetup category={category} projectId={projectId} queries={queries} back={back} />
    );
  // Keyed by holder, so typed prompt text and launch state never carry to the next page.
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

type Back = ReturnType<typeof backTo>;

/** A category's own page: who competes on its shelf, and its shopping-prompt matrix. */
function CategorySetup({
  category,
  projectId,
  queries,
  back,
}: Readonly<{
  category: CommerceCatalog['categories'][number];
  projectId: string;
  queries: CommerceQueries;
  back: Back;
}>) {
  const discovery = useCompetitorDiscovery(projectId);
  const target = { kind: 'category', id: category.id } as const;
  return (
    <DetailScreen title={category.name} back={back}>
      <Stack gap="workspace">
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
      </Stack>
    </DetailScreen>
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
  const { filters } = scope;
  const detail = useQuery(
    commerceQueries.productDetail(projectScope, holderId, productScopeSearch(filters)),
  );
  const promptSets = useQuery(promptsQueries.sets(projectScope));
  const engines = useEngineCatalog();
  const controls = {
    filters: productScopeFilters({
      scope,
      engines,
      promptSets: promptSets.data?.prompt_sets ?? [],
    }),
  };
  const back = backTo(filters);
  if (detail.isError)
    return (
      <DetailScreen back={back} controls={controls}>
        <QueryState
          kind="error"
          {...readErrorProps(detail)}
          fallback="This product could not be loaded."
        />
      </DetailScreen>
    );
  if (!detail.data)
    return (
      <DetailScreen back={back} controls={controls}>
        <QueryState kind="loading" label="Loading product" />
      </DetailScreen>
    );
  const data = detail.data;
  const named = data.answer_total > 0;
  return (
    <DetailScreen title={data.product.name} back={back} controls={controls}>
      <Stack gap="workspace" aria-busy={detail.isFetching}>
        <ProductKpis detail={data} scope={projectScope} />
        {named ? (
          <AppGrid layout="pair">
            <CompetingProducts detail={data} scope={filters} />
            <Merchants detail={data} />
            <Sources detail={data} />
            <FanOutQueries detail={data} />
          </AppGrid>
        ) : null}
        {named || data.prompts.length > 0 ? <PromptMetrics detail={data} /> : null}
        {named ? (
          <Answers detail={data} />
        ) : (
          // Every section below reads the answers that named it: with none,
          // one sentence says so instead of six empty cards.
          <Card>
            <QueryState
              kind="empty"
              icon={MessageSquareOff}
              heading={`No answer named it in the last ${data.window_days} days`}
              description="Its competing products, merchants, sources, fan-out queries and answers appear here once an answer in this window names it."
            />
          </Card>
        )}
        {/* An archived product takes no new competitors or shopping prompts until restored. */}
        {data.product.kind === 'owned' && data.product.catalog?.lifecycle_state !== 'archived' ? (
          <ProductSetup detail={data} projectId={projectId} queries={queries} />
        ) : null}
      </Stack>
    </DetailScreen>
  );
}

/**
 * Brand, who holds it, image, description and a link to its page; a catalog
 * product's Edit and Archive controls, or Add to tracking for a product the
 * answers showed.
 */
function ProductHeader({
  detail,
  scope,
}: Readonly<{ detail: CommerceProductDetail; scope: ProjectScope }>) {
  const { product } = detail;
  return (
    <Inline gap="compact" className="items-start">
      {product.image_url ? <ProductImage src={product.image_url} /> : null}
      <Stack gap="tight" className="min-w-0 flex-1">
        <span className="type-caption">
          {holderCaption(product)} · From{' '}
          <InlineFigure>{formatCount(detail.executions)}</InlineFigure>
          {detail.executions === 1 ? ' answer' : ' answers'} in the last {detail.window_days} days
        </span>
        {product.description ? (
          <p className={textRole('body', 'line-clamp-2')}>{product.description}</p>
        ) : null}
        {product.url ? (
          <TextLink variant="external" href={product.url} text="caption" className="truncate">
            {product.url}
          </TextLink>
        ) : null}
      </Stack>
      {product.catalog ? (
        <ProductCatalogControls scope={scope} product={product} catalog={product.catalog} />
      ) : null}
      {product.kind === 'ai_observed_competitor' ? (
        <AddToTracking scope={scope} candidateId={product.holder_id} name={product.name} />
      ) : null}
    </Inline>
  );
}

/** The product and its figures in one card: who holds it above, its KPIs in one row below. */
function ProductKpis({
  detail,
  scope,
}: Readonly<{ detail: CommerceProductDetail; scope: ProjectScope }>) {
  return (
    <KpiRow
      label="Product metrics"
      lead={<ProductHeader detail={detail} scope={scope} />}
      segments={KPIS.map((key) => {
        const column = PRODUCT_COLUMNS.find((row) => row.key === key);
        const label = column?.label ?? key;
        return {
          key,
          label,
          value: <MetricValue cell={productCell(detail.product, key)} />,
          // The definition is a hint on the label, not a paragraph under every figure.
          marker: column ? <InfoHint label={`About ${label}`}>{column.hint}</InfoHint> : undefined,
        };
      })}
    />
  );
}

/** Competitor discovery and review, hero-product prompts, and the Actions. */
function ProductSetup({
  detail,
  projectId,
  queries,
}: Readonly<{ detail: CommerceProductDetail; projectId: string; queries: CommerceQueries }>) {
  const discovery = useCompetitorDiscovery(projectId);
  const target = { kind: 'product', id: detail.product.holder_id } as const;
  return (
    <Stack as="section" gap="workspace" aria-labelledby="product-setup">
      <h2 id="product-setup" className={textRole('sectionTitle')}>
        Setup
      </h2>
      <ProductActions detail={detail} />
      <SetupCompetitors
        projectId={projectId}
        target={target}
        query={queries.competitors}
        discovery={discovery}
      />
      <SetupPrompts
        projectId={projectId}
        target={target}
        targetLabel={detail.product.name}
        query={queries.buyerPrompts}
      />
    </Stack>
  );
}
