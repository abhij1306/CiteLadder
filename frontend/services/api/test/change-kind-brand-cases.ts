import { randomUUID } from 'node:crypto';
import type { Database } from '../src/db/database.ts';
import { createBrandFact } from '../src/projects/brand-facts.ts';
import { createDiscovery } from '../src/projects/discovery.ts';
import { discoveryCreate } from '../src/projects/discovery-inputs.ts';
import { createTheme, listThemes } from '../src/projects/themes.ts';
import { auditTenant } from './audit-fixtures.ts';
import type { KindRow, KindScope, TabledKind } from './change-kind-cases.ts';
import type { SiteFixtures } from './site-health-fixtures.ts';

type BrandKind = Extract<
  TabledKind,
  | 'update_brand_profile'
  | 'update_business_map'
  | 'create_brand_fact'
  | 'update_brand_fact'
  | 'override_claim_verdict'
  | 'create_theme'
  | 'rename_theme'
  | 'merge_themes'
  | 'delete_theme'
  | 'start_brand_discovery'
  | 'rerun_brand_discovery'
  | 'complete_brand_discovery'
>;

const DISCOVERY = { brand_name: 'Acme', website_url: 'acme.com', primary_market: 'US' };

export function brandCases(db: Database, fixtures: SiteFixtures): Record<BrandKind, KindRow> {
  const tenant = () => auditTenant(db, fixtures);
  const count = (query: { execute: () => Promise<unknown[]> }) =>
    query.execute().then((found) => found.length);

  async function profile(t: KindScope) {
    const brand = await db
      .selectFrom('brands')
      .select('id')
      .where('project_id', '=', t.projectId)
      .executeTakeFirstOrThrow();
    const now = new Date();
    await db
      .insertInto('brand_profiles')
      .values({
        id: randomUUID(),
        workspace_id: t.workspaceId,
        project_id: t.projectId,
        brand_id: brand.id,
        business_context: '{}',
        description: '',
        positioning: '',
        target_audience: '',
        products_services: JSON.stringify(['Trail Runner']),
        sources: '{}',
        source_artifact_ids: '{}',
        created_at: now,
        updated_at: now,
      })
      .execute();
  }

  async function claimVerdict(t: KindScope) {
    const auditId = await fixtures.audit(t);
    const { taskId, analysisId } = await fixtures.execution(t, {
      auditId,
      answerText: 'Acme Pro costs $49 per month.',
    });
    const analysis = await db
      .selectFrom('response_analyses')
      .select('artifact_id')
      .where('id', '=', analysisId!)
      .executeTakeFirstOrThrow();
    const ids = { perception: randomUUID(), claim: randomUUID(), verification: randomUUID() };
    const verdictId = randomUUID();
    const now = new Date();
    const run = { workspace_id: t.workspaceId, project_id: t.projectId, audit_id: auditId };
    await db
      .insertInto('answer_perceptions')
      .values({
        ...run,
        id: ids.perception,
        task_id: taskId,
        analysis_id: analysisId!,
        artifact_id: analysis.artifact_id,
        extractor_version: 'test',
        template_version: 'test',
        outcome: 'classified',
        created_at: now,
      })
      .execute();
    await db
      .insertInto('answer_claims')
      .values({
        id: ids.claim,
        workspace_id: t.workspaceId,
        perception_id: ids.perception,
        ordinal: 0,
        topic: 'pricing',
        claim: 'Acme Pro costs $49 per month.',
        quote: 'Acme Pro costs $49 per month.',
        quote_start: 0,
        quote_end: 29,
        confidence: 0.9,
        low_confidence: false,
      })
      .execute();
    await db
      .insertInto('fact_verifications')
      .values({
        ...run,
        id: ids.verification,
        task_id: taskId,
        perception_id: ids.perception,
        verify_template_version: 'test',
        outcome: 'verified',
        created_at: now,
      })
      .execute();
    await db
      .insertInto('claim_verdicts')
      .values({
        id: verdictId,
        workspace_id: t.workspaceId,
        verification_id: ids.verification,
        claim_id: ids.claim,
        verdict: 'contradicted',
        model_verdict: 'contradicted',
        fact_revision_ids: '[]',
        confidence: 0.9,
        low_confidence: false,
      })
      .execute();
    return verdictId;
  }

  async function discovery(t: KindScope, status: 'failed' | 'ready') {
    const row = await createDiscovery(
      db,
      t.workspaceId,
      discoveryCreate.parse(DISCOVERY),
      randomUUID(),
    );
    await db
      .insertInto('brand_research_snapshots')
      .values({
        id: randomUUID(),
        workspace_id: t.workspaceId,
        discovery_id: row.id,
        research_version: '1',
        provider: '',
        model: '',
        method: 'recorded-test',
        extracted_fields: JSON.stringify({ themes: ['Price'] }),
        field_confidence: '{}',
        warnings: '[]',
        created_at: new Date(),
      })
      .execute();
    await db.updateTable('brand_discoveries').set({ status }).where('id', '=', row.id).execute();
    await db
      .updateTable('brand_discovery_tasks')
      .set({ status: 'succeeded', completed_at: new Date() })
      .where('discovery_id', '=', row.id)
      .execute();
    return row.id;
  }

  const discoveries = (t: KindScope) =>
    count(
      db.selectFrom('brand_discoveries').select('id').where('workspace_id', '=', t.workspaceId),
    );
  const themeNames = (t: KindScope) =>
    listThemes(db, t).then((rows) => rows.map((row) => row.name));

  return {
    update_brand_profile: {
      foreign: 'none',
      async arrange() {
        const t = await tenant();
        await profile(t);
        return {
          scope: t,
          payload: { description: 'Trail shoes for wet climates' },
          observe: () =>
            db
              .selectFrom('brand_profiles')
              .select('description')
              .where('project_id', '=', t.projectId)
              .executeTakeFirstOrThrow()
              .then((row) => row.description),
          before: '',
          after: 'Trail shoes for wet climates',
        };
      },
    },
    update_business_map: {
      foreign: 'none',
      async arrange() {
        const t = await tenant();
        await profile(t);
        return {
          scope: t,
          payload: {
            offerings: [{ offering: 'Trail Runner', audiences: [{ value: 'Trail runners' }] }],
          },
          observe: () =>
            db
              .selectFrom('brand_profiles')
              .select('business_context')
              .where('project_id', '=', t.projectId)
              .executeTakeFirstOrThrow()
              .then((row) => JSON.stringify(row.business_context).includes('Trail runners')),
          before: false,
          after: true,
        };
      },
    },
    create_brand_fact: {
      foreign: 'none',
      async arrange() {
        const t = await tenant();
        return {
          scope: t,
          payload: { topic: 'pricing', statement: 'Acme Pro costs $59 per month.' },
          observe: () =>
            db
              .selectFrom('brand_facts')
              .select(['statement', 'status'])
              .where('project_id', '=', t.projectId)
              .execute(),
          before: [],
          after: [{ statement: 'Acme Pro costs $59 per month.', status: 'draft' }],
        };
      },
    },
    update_brand_fact: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const created = await createBrandFact(db, t, t.userId, {
          topic: 'pricing',
          statement: 'Acme Pro costs $49 per month.',
        });
        return {
          scope: t,
          payload: { fact_id: created.id, statement: 'Acme Pro costs $59 per month.' },
          observe: () =>
            db
              .selectFrom('brand_facts')
              .select(['statement', 'status', 'revision'])
              .where('id', '=', created.id)
              .executeTakeFirstOrThrow(),
          before: { statement: 'Acme Pro costs $49 per month.', status: 'draft', revision: 1 },
          after: { statement: 'Acme Pro costs $59 per month.', status: 'draft', revision: 2 },
        };
      },
    },
    override_claim_verdict: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const verdictId = await claimVerdict(t);
        return {
          scope: t,
          payload: {
            verdict_id: verdictId,
            verdict: 'supported',
            note: 'Checked the pricing page',
          },
          observe: () =>
            db
              .selectFrom('claim_verdict_overrides')
              .select(['from_verdict', 'to_verdict'])
              .where('claim_verdict_id', '=', verdictId)
              .execute(),
          before: [],
          after: [{ from_verdict: 'contradicted', to_verdict: 'supported' }],
        };
      },
    },
    create_theme: {
      foreign: 'none',
      async arrange() {
        const t = await tenant();
        return {
          scope: t,
          payload: { name: 'Comfort' },
          observe: () => themeNames(t),
          before: [],
          after: ['Comfort'],
        };
      },
    },
    rename_theme: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const theme = await createTheme(db, t, { name: 'Comfort' });
        return {
          scope: t,
          payload: { theme_id: theme.id, name: 'Grip' },
          observe: () => themeNames(t),
          before: ['Comfort'],
          after: ['Grip'],
        };
      },
    },
    merge_themes: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const theme = await createTheme(db, t, { name: 'Comfort' });
        const into = await createTheme(db, t, { name: 'Fit' });
        return {
          scope: t,
          payload: { theme_id: theme.id, into_id: into.id },
          observe: () => themeNames(t),
          before: ['Comfort', 'Fit'],
          after: ['Fit'],
        };
      },
    },
    delete_theme: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const theme = await createTheme(db, t, { name: 'Comfort' });
        return {
          scope: t,
          payload: { theme_id: theme.id },
          observe: () => themeNames(t),
          before: ['Comfort'],
          after: [],
        };
      },
    },
    start_brand_discovery: {
      foreign: 'none',
      async arrange() {
        const t = await tenant();
        return {
          scope: t,
          payload: DISCOVERY,
          observe: () => discoveries(t),
          before: 0,
          after: 1,
        };
      },
    },
    rerun_brand_discovery: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const id = await discovery(t, 'failed');
        return {
          scope: t,
          payload: { discovery_id: id },
          observe: () => discoveries(t),
          before: 1,
          after: 2,
        };
      },
    },
    complete_brand_discovery: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const id = await discovery(t, 'ready');
        return {
          scope: t,
          payload: {
            discovery_id: id,
            completion: { profile: { category: 'Running shoes' }, domains: ['acme.com'] },
          },
          observe: () =>
            count(db.selectFrom('projects').select('id').where('workspace_id', '=', t.workspaceId)),
          before: 1,
          after: 2,
        };
      },
    },
  };
}
