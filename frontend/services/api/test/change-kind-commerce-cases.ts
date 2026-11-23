import { randomUUID } from 'node:crypto';
import { manualBuyerPrompt } from '../src/commerce/buyer-prompts.ts';
import type { Database } from '../src/db/database.ts';
import { auditTenant } from './audit-fixtures.ts';
import type { KindRow, KindScope, TabledKind } from './change-kind-cases.ts';
import { importCatalog } from './commerce-support.ts';
import type { SiteFixtures } from './site-health-fixtures.ts';

type CommerceKind = Extract<
  TabledKind,
  | 'discover_commerce_competitors'
  | 'generate_buyer_prompts'
  | 'add_buyer_prompt'
  | 'edit_product'
  | 'set_product_lifecycle'
  | 'decide_competitor_candidate'
  | 'decide_buyer_prompt'
>;

export function commerceCases(db: Database, fixtures: SiteFixtures): Record<CommerceKind, KindRow> {
  const count = (query: { execute: () => Promise<unknown[]> }) =>
    query.execute().then((found) => found.length);

  async function shop() {
    const t = await auditTenant(db, fixtures);
    await importCatalog(
      db,
      t,
      'sku,title,brand,price,category\nA1,Trail Runner,Acme,120,Footwear\n',
    );
    const product = await db
      .selectFrom('commerce_products')
      .select('id')
      .where('project_id', '=', t.projectId)
      .executeTakeFirstOrThrow();
    const category = await db
      .selectFrom('commerce_categories')
      .select('id')
      .where('project_id', '=', t.projectId)
      .executeTakeFirstOrThrow();
    const productField = (field: 'name' | 'lifecycle_state') => () =>
      db
        .selectFrom('commerce_products')
        .select(field)
        .where('id', '=', product.id)
        .executeTakeFirstOrThrow()
        .then((row) => row[field]);
    return { t, productId: product.id, categoryId: category.id, productField };
  }

  const promptTargets = (t: KindScope) =>
    count(
      db.selectFrom('commerce_prompt_targets').select('id').where('project_id', '=', t.projectId),
    );

  return {
    discover_commerce_competitors: {
      foreign: 404,
      async arrange() {
        const { t, productId } = await shop();
        return {
          scope: t,
          payload: { targets: [{ kind: 'product', id: productId }] },
          observe: () =>
            count(
              db
                .selectFrom('analytics_tasks')
                .select('id')
                .where('project_id', '=', t.projectId)
                .where('task_kind', '=', 'commerce_competitor_discovery'),
            ),
          before: 0,
          after: 1,
        };
      },
    },
    generate_buyer_prompts: {
      foreign: 404,
      live: true,
      async arrange() {
        const { t, categoryId } = await shop();
        return {
          scope: t,
          payload: { targets: [{ kind: 'category', id: categoryId }] },
          observe: () => promptTargets(t),
          before: 0,
          after: 0,
        };
      },
    },
    add_buyer_prompt: {
      foreign: 404,
      async arrange() {
        const { t, categoryId } = await shop();
        return {
          scope: t,
          payload: {
            target: { kind: 'category', id: categoryId },
            text: 'Which trail shoes grip wet rock?',
          },
          observe: () => promptTargets(t),
          before: 0,
          after: 1,
        };
      },
    },
    edit_product: {
      foreign: 404,
      async arrange() {
        const { t, productId, productField } = await shop();
        return {
          scope: t,
          payload: { product_id: productId, edit: { name: 'Trail Runner 2' } },
          observe: productField('name'),
          before: 'Trail Runner',
          after: 'Trail Runner 2',
        };
      },
    },
    set_product_lifecycle: {
      foreign: 404,
      async arrange() {
        const { t, productId, productField } = await shop();
        return {
          scope: t,
          payload: { product_id: productId, lifecycle_state: 'archived' },
          observe: productField('lifecycle_state'),
          before: 'active',
          after: 'archived',
        };
      },
    },
    decide_competitor_candidate: {
      foreign: 404,
      async arrange() {
        const { t, productId } = await shop();
        const id = randomUUID();
        await db
          .insertInto('commerce_competitor_candidates')
          .values({
            id,
            workspace_id: t.workspaceId,
            project_id: t.projectId,
            target_kind: 'product',
            target_id: productId,
            canonical_url: 'https://rival.example/products/rival',
            product_name: 'Rival Runner',
            brand_name: 'Rival',
            evidence: '{}',
            source_kind: 'tavily',
            state: 'pending',
            created_at: new Date(),
          })
          .execute();
        return {
          scope: t,
          payload: { candidate_id: id, decision: 'approved' },
          observe: () =>
            db
              .selectFrom('commerce_competitor_candidates')
              .select('state')
              .where('id', '=', id)
              .executeTakeFirstOrThrow()
              .then((row) => row.state),
          before: 'pending',
          after: 'approved',
        };
      },
    },
    decide_buyer_prompt: {
      foreign: 404,
      async arrange() {
        const { t, categoryId } = await shop();
        const created = await manualBuyerPrompt(db, t, {
          target: { kind: 'category', id: categoryId },
          text: 'Which trail shoes grip wet rock?',
        });
        return {
          scope: t,
          payload: { prompt_id: created.id, approved: true },
          observe: () =>
            db
              .selectFrom('commerce_prompt_targets')
              .select('approved_at')
              .where('prompt_id', '=', created.id)
              .executeTakeFirstOrThrow()
              .then((row) => row.approved_at !== null),
          before: false,
          after: true,
        };
      },
    },
  };
}
