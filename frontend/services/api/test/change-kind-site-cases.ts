import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import * as bindingsOwner from '../src/agent/bindings.ts';
import { createAgentBindings } from '../src/agent/bindings.ts';
import type { AdmittedModel } from '../src/agent/store.ts';
import type { Database } from '../src/db/database.ts';
import { issueGroupId } from '../src/site-health/reads/rules.ts';
import { auditTenant } from './audit-fixtures.ts';
import type { KindRow, KindScope, TabledKind } from './change-kind-cases.ts';
import { actionRow, opportunityRow } from './opportunity-fixtures.ts';
import { prompt, promptSet, topic } from './prompt-fixtures.ts';
import { landFinalRevisions } from './site-health-finalize-fixtures.ts';
import { bodyFacts, type SiteFixtures, type SiteSeed } from './site-health-fixtures.ts';

const SITEMAP = 'technical.sitemap_redirect';

export function siteAndActionCases(db: Database, fixtures: SiteFixtures) {
  const tenant = () => auditTenant(db, fixtures);
  const rows = <T>(query: { execute: () => Promise<T[]> }) => query.execute();
  const one = async <T>(query: { executeTakeFirst: () => Promise<T | undefined> }) =>
    query.executeTakeFirst();

  const crawls = (seed: KindScope) =>
    rows(db.selectFrom('site_crawls').select('id').where('project_id', '=', seed.projectId)).then(
      (found) => found.length,
    );

  async function land(seed: SiteSeed) {
    await db.transaction().execute(async (trx) => {
      const crawl = await trx
        .selectFrom('site_crawls')
        .selectAll()
        .where('id', '=', seed.crawlId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      await landFinalRevisions(trx, crawl);
    });
  }

  async function issueSeed() {
    const seed = await fixtures.crawl();
    const page = await fixtures.page(seed, '/a', {}, { observed: true });
    await fixtures.monitor(seed, [page.id]);
    const evaluationId = await fixtures.evaluation(seed, page, SITEMAP, 'missing');
    await fixtures.issue(seed, page, SITEMAP, evaluationId);
    await land(seed);
    return { seed, groupId: issueGroupId(seed.crawlId, SITEMAP) };
  }

  async function contentPage(seed: SiteSeed, path: string, kind: string) {
    const page = await fixtures.page(
      seed,
      path,
      bodyFacts(`<main><h1>${path}</h1><p>How teams choose a CRM for ${path}.</p></main>`),
      { observed: true },
    );
    await db
      .updateTable('site_page_analyses')
      .set({ page_kind: kind })
      .where('id', '=', page.analysisId)
      .execute();
    return page.id;
  }

  async function action(t: KindScope) {
    const row = actionRow(
      { workspace_id: t.workspaceId, project_id: t.projectId },
      { group_key: randomUUID(), target_kind: 'page', target_label: 'https://example.test/a' },
    );
    await db.insertInto('actions').values(row).execute();
    const status = () =>
      one(db.selectFrom('actions').select('status').where('id', '=', row.id)).then(
        (found) => found?.status,
      );
    return { id: row.id, status };
  }

  return {
    start_crawl: {
      foreign: 'none',
      async arrange() {
        const seed = await fixtures.crawl();
        return { scope: seed, payload: {}, observe: () => crawls(seed), before: 1, after: 2 };
      },
    },
    cancel_crawl: {
      foreign: 404,
      async arrange() {
        const seed = await fixtures.crawl('running');
        return {
          scope: seed,
          payload: { crawl_id: seed.crawlId },
          observe: () =>
            one(db.selectFrom('site_crawls').select('status').where('id', '=', seed.crawlId)).then(
              (row) => row?.status,
            ),
          before: 'running',
          after: 'cancelled',
        };
      },
    },
    set_crawl_schedule: {
      foreign: 'none',
      async arrange() {
        const seed = await fixtures.crawl();
        return {
          scope: seed,
          payload: { enabled: true, cadence: 'weekly' },
          observe: () =>
            one(
              db
                .selectFrom('crawl_schedules')
                .select(['enabled', 'cadence'])
                .where('project_id', '=', seed.projectId),
            ),
          before: undefined,
          after: { enabled: true, cadence: 'weekly' },
        };
      },
    },
    rerun_page: {
      foreign: 404,
      async arrange() {
        const seed = await fixtures.crawl();
        const page = await fixtures.page(seed, '/a', {}, { observed: true });
        await fixtures.monitor(seed, [page.id]);
        await db
          .updateTable('projects')
          .set({ website_url: '' })
          .where('id', '=', seed.projectId)
          .execute();
        return {
          scope: seed,
          payload: { crawl_id: seed.crawlId, site_url_id: page.id },
          observe: () => crawls(seed),
          before: 1,
          after: 2,
        };
      },
    },
    mark_issue_group_fixed: {
      foreign: 404,
      async arrange() {
        const { seed, groupId } = await issueSeed();
        return {
          scope: seed,
          payload: { crawl_id: seed.crawlId, group_id: groupId },
          observe: () =>
            rows(
              db
                .selectFrom('site_issue_states')
                .select('state')
                .where('project_id', '=', seed.projectId),
            ).then((found) => found.map((row) => row.state)),
          before: ['open'],
          after: ['marked_fixed'],
        };
      },
    },
    rerun_issue_group: {
      foreign: 404,
      async arrange() {
        const { seed, groupId } = await issueSeed();
        return {
          scope: seed,
          payload: { crawl_id: seed.crawlId, group_id: groupId },
          observe: () => crawls(seed),
          before: 1,
          after: 2,
        };
      },
    },
    start_link_analysis: {
      foreign: 404,
      async arrange() {
        const seed = await fixtures.crawl();
        await contentPage(seed, '/guide', 'guide');
        await contentPage(seed, '/pricing', 'comparison');
        await land(seed);
        return {
          scope: seed,
          payload: { crawl_id: seed.crawlId },
          observe: () =>
            rows(
              db
                .selectFrom('site_internal_link_runs')
                .select('state')
                .where('project_id', '=', seed.projectId),
            ).then((found) => found.map((row) => row.state)),
          before: [],
          after: ['queued'],
        };
      },
    },
    cancel_link_analysis: {
      foreign: 404,
      async arrange() {
        const seed = await fixtures.crawl();
        const id = randomUUID();
        await db
          .insertInto('site_internal_link_runs')
          .values({
            id,
            workspace_id: seed.workspaceId,
            project_id: seed.projectId,
            crawl_id: seed.crawlId,
            actor_id: seed.userId,
            idempotency_key: randomUUID(),
            manifest: JSON.stringify({ page_count: 2, omitted_pages: 0 }),
            policy_version: 1,
            result: null,
            state: 'queued',
            created_at: new Date(),
          })
          .execute();
        return {
          scope: seed,
          payload: { analysis_id: id },
          observe: () =>
            one(db.selectFrom('site_internal_link_runs').select('state').where('id', '=', id)).then(
              (row) => row?.state,
            ),
          before: 'queued',
          after: 'cancelled',
        };
      },
    },
    update_action_status: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const { id, status } = await action(t);
        return {
          scope: t,
          payload: { action_id: id, status: 'dismissed' },
          observe: status,
          before: 'open',
          after: 'dismissed',
        };
      },
    },
    update_actions_status: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const { id, status } = await action(t);
        return {
          scope: t,
          payload: { ids: [id], to: 'dismissed' },
          observe: status,
          before: 'open',
          after: 'dismissed',
        };
      },
    },
    analyze_page: {
      foreign: 422,
      async arrange() {
        vi.spyOn(bindingsOwner, 'agentBindings').mockImplementation(async (handle) => {
          const bindings = await createAgentBindings(handle, {});
          bindings.store.dependencies.admission = () =>
            Promise.resolve({
              requested_model: 'test-model',
            } satisfies AdmittedModel);
          return bindings;
        });
        const seed = await fixtures.crawl();
        const page = await contentPage(seed, '/crm-pricing', 'comparison');
        const set = await promptSet(db, seed.projectId);
        const crm = await topic(db, seed.projectId, 'CRM software');
        const asked = await prompt(db, set, 'best crm for small teams', { topicId: crm });
        return {
          scope: seed,
          payload: { site_url_id: page, topic_id: crm, prompt_ids: [asked] },
          observe: () =>
            rows(
              db.selectFrom('agent_chats').select('id').where('project_id', '=', seed.projectId),
            ).then((found) => found.length),
          before: 0,
          after: 1,
        };
      },
    },
    reorder_opportunities: {
      foreign: 422,
      async arrange() {
        const t = await tenant();
        const scope = { workspace_id: t.workspaceId, project_id: t.projectId };
        const [first, second] = ['a', 'b'].map((key) =>
          opportunityRow(scope, {
            rule_id: 'site_link_near_orphan',
            opportunity_type: 'site',
            severity: 'medium',
            target_key: `https://example.test/${key}`,
          }),
        );
        await db.insertInto('opportunities').values([first!, second!]).execute();
        return {
          scope: t,
          payload: { ordered_opportunity_ids: [second!.id, first!.id], expected_version: 0 },
          observe: () =>
            one(
              db
                .selectFrom('opportunity_orders')
                .select('version')
                .where('project_id', '=', t.projectId),
            ).then((row) => row?.version),
          before: undefined,
          after: 1,
        };
      },
    },
  } satisfies Partial<Record<TabledKind, KindRow>>;
}
