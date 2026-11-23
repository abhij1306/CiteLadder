import { buyerPrompts, candidates, catalog, discoveries } from '../commerce/reads.ts';
import { pageOf, unavailable } from './data.ts';
import { withoutQuery, withoutQueryDeep } from './evidence-site.ts';
import type { Evidence, ProjectRead } from './types.ts';

type Page = { cursor?: string | null; limit?: number | null };
export type CommerceView = 'catalog' | 'competitor_candidates' | 'buyer_prompts' | 'discoveries';

const NO_CATALOG = 'no_product_catalog';
const hasCatalog = ({ product_total, projection }: Awaited<ReturnType<typeof catalog>>) =>
  projection.applicability === 'applicable' || product_total > 0;

async function setupRows({ db, scope }: ProjectRead, view: Exclude<CommerceView, 'catalog'>) {
  switch (view) {
    case 'competitor_candidates':
      return (await candidates(db, scope)).map((candidate) => ({
        ...candidate,
        canonical_url: withoutQuery(candidate.canonical_url),
        evidence: withoutQueryDeep(candidate.evidence),
      }));
    case 'buyer_prompts':
      return buyerPrompts(db, scope);
    case 'discoveries':
      return discoveries(db, scope, null);
    default: {
      const unknown: never = view;
      throw new Error(`Unknown commerce view ${String(unknown)}`);
    }
  }
}

export async function commerceSetup(
  read: ProjectRead,
  args: Page & { view: CommerceView },
): Promise<Evidence> {
  const scope = { endpoint: `mcp_commerce_${args.view}`, filters: read.scope };
  if (args.view === 'catalog') {
    const owned = await catalog(read.db, read.scope);
    if (!hasCatalog(owned)) return unavailable(NO_CATALOG);
    const page = pageOf(
      owned.products.map((product) => ({
        ...product,
        canonical_url: withoutQuery(product.canonical_url),
      })),
      args,
      scope,
    );
    return {
      state: 'available',
      view: args.view,
      product_total: owned.product_total,
      categories: owned.categories,
      items: page.items,
      pagination: page.pagination,
    };
  }
  const rows = await setupRows(read, args.view);
  if (!rows.length && !hasCatalog(await catalog(read.db, read.scope)))
    return unavailable(NO_CATALOG);
  const page = pageOf<{ id: string }>(rows, args, scope);
  return { state: 'available', view: args.view, items: page.items, pagination: page.pagination };
}
