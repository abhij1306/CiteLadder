import { randomUUID } from 'node:crypto';
import type { Database } from '../src/db/database.ts';
import { policy } from '../src/config.ts';
import { SiteFixtures } from './site-health-fixtures.ts';
import { prompt, promptSet } from './prompt-fixtures.ts';
import { testDatabase } from './support.ts';

async function seed(db: Database) {
  const fixtures = new SiteFixtures(db);
  const seed = await fixtures.crawl('queued');
  const brandId = randomUUID();
  const now = new Date();
  await db
    .insertInto('brands')
    .values({
      id: brandId,
      project_id: seed.projectId,
      name: 'Acme',
      created_at: now,
      updated_at: now,
    })
    .execute();
  await db
    .insertInto('brand_profiles')
    .values({
      id: randomUUID(),
      workspace_id: seed.workspaceId,
      project_id: seed.projectId,
      brand_id: brandId,
      business_context: JSON.stringify({ business_model: 'retail' }),
      description: '',
      positioning: '',
      target_audience: '',
      products_services: '[]',
      sources: '[]',
      source_artifact_ids: '[]',
      created_at: now,
      updated_at: now,
    })
    .execute();
  const analyses: string[] = [];
  for (const product of [false, true]) {
    const url = product
      ? 'https://example.com/products/widget'
      : 'https://example.com/collections/tools';
    const page = await fixtures.page(seed, url, {
      canonical_url: url,
      headings: { h1_texts: [product ? 'Widget' : 'Tools'] },
      structured_data: product
        ? { product: { sku: ['W1'], price: ['12.50'], price_currency: ['USD'] } }
        : {},
      links: { anchors: [{ region: 'main', url: '/collections/tools/products/widget' }] },
    });
    await db
      .updateTable('site_page_analyses')
      .set({ page_kind: product ? 'product' : 'category' })
      .where('id', '=', page.analysisId)
      .execute();
    analyses.push(page.analysisId);
  }
  return {
    workspaceId: seed.workspaceId,
    projectId: seed.projectId,
    userId: seed.userId,
    analyses,
  };
}

async function commercePrompt(
  db: Database,
  workspace: string,
  project: string,
  target: string,
  kind = 'product',
) {
  const setId = await promptSet(db, project);
  const promptId = await prompt(db, setId, 'best tools for a small workshop');
  await db
    .updateTable('prompts')
    .set({ enabled: false, cohort: 'commerce' })
    .where('id', '=', promptId)
    .execute();
  await db
    .insertInto('commerce_prompt_targets')
    .values({
      id: randomUUID(),
      workspace_id: workspace,
      project_id: project,
      prompt_id: promptId,
      target_kind: kind,
      target_id: target,
      template_version: policy.commerce.buyer_prompts.version,
      created_at: new Date(),
    })
    .execute();
  const candidateId = randomUUID();
  await db
    .insertInto('commerce_competitor_candidates')
    .values({
      id: candidateId,
      workspace_id: workspace,
      project_id: project,
      target_kind: kind,
      target_id: target,
      canonical_url: 'https://rival.example/products/rival',
      product_name: 'Rival',
      brand_name: 'Rival',
      evidence: '{}',
      source_kind: 'tavily',
      state: 'pending',
      created_at: new Date(),
    })
    .execute();
  return { promptId, candidateId };
}

/** Deterministic persisted catalog pages and targets on disposable PostgreSQL. */
export async function commerceFixture<T>(phase: string, ...args: string[]): Promise<T> {
  const db = testDatabase();
  try {
    return await db.transaction().execute(async (trx) => {
      if (phase === 'seed') return (await seed(trx)) as T;
      if (phase === 'prompt')
        return (await commercePrompt(trx, args[0]!, args[1]!, args[2]!, args[3])) as T;
      throw new Error(`Unknown Commerce fixture phase: ${phase}`);
    });
  } finally {
    await db.destroy();
  }
}
