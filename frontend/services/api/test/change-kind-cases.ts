import { randomUUID } from 'node:crypto';
import type { Json } from '../src/agent/contracts.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { createAudits } from '../src/audits/creation.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { scheduleCreate } from '../src/audits/schedule-inputs.ts';
import { createSchedule } from '../src/audits/schedules.ts';
import type { AgentChangeKind } from '../src/agent/change-proposals.ts';
import type { Database } from '../src/db/database.ts';
import { addMarket } from '../src/projects/markets.ts';
import { auditTenant } from './audit-fixtures.ts';
import { brandCases } from './change-kind-brand-cases.ts';
import { commerceCases } from './change-kind-commerce-cases.ts';
import { dataCases } from './change-kind-data-cases.ts';
import { siteAndActionCases } from './change-kind-site-cases.ts';
import { candidate, generationRun, topic } from './prompt-fixtures.ts';
import type { SiteFixtures } from './site-health-fixtures.ts';

export const IMPORT_KINDS = ['import_prompts', 'import_brand_facts', 'import_catalog'] as const;
export type TabledKind = Exclude<AgentChangeKind, (typeof IMPORT_KINDS)[number]>;
export type KindScope = { workspaceId: string; projectId: string; userId: string };
type KindCase = {
  scope: KindScope;
  payload: Record<string, Json>;
  observe: () => Promise<unknown>;
  before: unknown;
  after: unknown;
};
export type KindRow = {
  arrange: () => Promise<KindCase>;
  foreign: 404 | 422 | 'none';
  live?: true;
};

export function kindCases(db: Database, fixtures: SiteFixtures) {
  const runtime = auditRuntime({});
  const tenant = () => auditTenant(db, fixtures);
  const rows = <T>(query: { execute: () => Promise<T[]> }) => query.execute();
  const one = async <T>(query: { executeTakeFirst: () => Promise<T | undefined> }) =>
    query.executeTakeFirst();
  const promptsIn = (setId: string) =>
    rows(db.selectFrom('prompts').select('id').where('prompt_set_id', '=', setId)).then(
      (found) => found.length,
    );
  const topicsOf = (t: KindScope) =>
    rows(db.selectFrom('topics').select('id').where('project_id', '=', t.projectId)).then(
      (found) => found.length,
    );
  const setsOf = (t: KindScope) =>
    rows(db.selectFrom('prompt_sets').select('id').where('project_id', '=', t.projectId)).then(
      (found) => found.length,
    );

  async function markets(t: KindScope) {
    return () =>
      rows(
        db
          .selectFrom('project_markets')
          .select('country_code')
          .where('project_id', '=', t.projectId),
      ).then((found) => found.map((row) => row.country_code));
  }

  async function queuedAudit(t: Awaited<ReturnType<typeof tenant>>) {
    const [id] = await createAudits(
      db,
      t.workspaceId,
      auditInput.parse({ project_id: t.projectId, prompt_set_id: t.setId, engines: ['chatgpt'] }),
      {},
      runtime,
    );
    return id!;
  }

  const auditStatus = (id: string) =>
    one(db.selectFrom('audits').select('status').where('id', '=', id)).then((row) => row?.status);

  async function schedule(t: Awaited<ReturnType<typeof tenant>>) {
    const created = await createSchedule(
      db,
      t,
      scheduleCreate.parse({ prompt_set_id: t.setId, cadence: 'daily', engines: ['chatgpt'] }),
    );
    return created.id;
  }

  const table: Record<TabledKind, KindRow> = {
    ...siteAndActionCases(db, fixtures),
    ...dataCases(db, fixtures),
    ...commerceCases(db, fixtures),
    ...brandCases(db, fixtures),
    add_prompts: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        return {
          scope: t,
          payload: {
            prompt_set_id: t.setId,
            prompts: [{ text: 'Which running shoes grip trails best?' }],
          },
          observe: () => promptsIn(t.setId),
          before: 1,
          after: 2,
        };
      },
    },
    update_prompts: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        return {
          scope: t,
          payload: {
            kind: 'status',
            status: 'archived',
            groups: [{ prompt_set_id: t.setId, prompt_ids: [t.promptId] }],
          },
          observe: () =>
            one(db.selectFrom('prompts').select('status').where('id', '=', t.promptId)).then(
              (row) => row?.status,
            ),
          before: 'active',
          after: 'archived',
        };
      },
    },
    update_prompt_text: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const topicId = await topic(db, t.projectId, 'Road');
        return {
          scope: t,
          payload: {
            prompt_id: t.promptId,
            text: 'Which running shoes last longest on roads?',
            buyer_stage: 'consideration',
            persona: 'Marathon runner',
            topic_id: topicId,
          },
          observe: () =>
            one(
              db
                .selectFrom('prompts')
                .select(['text', 'buyer_stage', 'persona', 'topic_id'])
                .where('id', '=', t.promptId),
            ).then((row) => row && { ...row, topic_id: row.topic_id === topicId }),
          before: {
            text: 'Which running shoes suit road use?',
            buyer_stage: '',
            persona: '',
            topic_id: false,
          },
          after: {
            text: 'Which running shoes last longest on roads?',
            buyer_stage: 'consideration',
            persona: 'Marathon runner',
            topic_id: true,
          },
        };
      },
    },
    update_project: {
      foreign: 'none',
      async arrange() {
        const t = await tenant();
        const details = () =>
          one(
            db
              .selectFrom('projects')
              .select(['brand_name', 'default_repetitions'])
              .where('id', '=', t.projectId),
          );
        return {
          scope: t,
          payload: { brand_name: 'Acme Trail', default_repetitions: 2 },
          observe: details,
          before: await details(),
          after: { brand_name: 'Acme Trail', default_repetitions: 2 },
        };
      },
    },
    create_topic: {
      foreign: 'none',
      async arrange() {
        const t = await tenant();
        return {
          scope: t,
          payload: { name: 'Trail' },
          observe: () => topicsOf(t),
          before: 0,
          after: 1,
        };
      },
    },
    rename_topic: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const id = await topic(db, t.projectId, 'Trail');
        return {
          scope: t,
          payload: { topic_id: id, name: 'Road' },
          observe: () =>
            one(db.selectFrom('topics').select('name').where('id', '=', id)).then(
              (row) => row?.name,
            ),
          before: 'Trail',
          after: 'Road',
        };
      },
    },
    confirm_topics: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const id = await topic(db, t.projectId, 'Trail');
        await db
          .updateTable('prompts')
          .set({ topic_id: id })
          .where('id', '=', t.promptId)
          .execute();
        return {
          scope: t,
          payload: { delete: [id] },
          observe: () => topicsOf(t),
          before: 1,
          after: 0,
        };
      },
    },
    delete_topic: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const id = await topic(db, t.projectId, 'Trail');
        await db
          .updateTable('prompts')
          .set({ topic_id: id })
          .where('id', '=', t.promptId)
          .execute();
        return {
          scope: t,
          payload: { topic_id: id },
          observe: () => topicsOf(t),
          before: 1,
          after: 0,
        };
      },
    },
    create_prompt_set: {
      foreign: 'none',
      async arrange() {
        const t = await tenant();
        return {
          scope: t,
          payload: { name: 'Trail' },
          observe: () => setsOf(t),
          before: 1,
          after: 2,
        };
      },
    },
    rename_prompt_set: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        return {
          scope: t,
          payload: { prompt_set_id: t.setId, name: 'Trail' },
          observe: () =>
            one(db.selectFrom('prompt_sets').select('name').where('id', '=', t.setId)).then(
              (row) => row?.name,
            ),
          before: 'Set',
          after: 'Trail',
        };
      },
    },
    delete_prompt_set: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        return {
          scope: t,
          payload: { prompt_set_id: t.setId },
          observe: () => setsOf(t),
          before: 1,
          after: 0,
        };
      },
    },
    delete_prompts: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        await queuedAudit(t);
        return {
          scope: t,
          payload: { prompt_ids: [t.promptId] },
          observe: () => promptsIn(t.setId),
          before: 1,
          after: 0,
        };
      },
    },
    review_prompt_candidates: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const runId = await generationRun(db, { ...t, setId: t.setId }, {});
        const id = await candidate(db, { ...t, setId: t.setId, runId }, 'Which trail shoes last?');
        return {
          scope: t,
          payload: { prompt_set_id: t.setId, accept_ids: [id] },
          observe: () => promptsIn(t.setId),
          before: 1,
          after: 2,
        };
      },
    },
    generate_prompts: {
      foreign: 404,
      live: true,
      async arrange() {
        const t = await tenant();
        await topic(db, t.projectId, 'Road');
        return {
          scope: t,
          payload: { prompt_set_id: t.setId, request: { count: 3 } },
          observe: () =>
            rows(
              db
                .selectFrom('prompt_generation_runs')
                .select('id')
                .where('prompt_set_id', '=', t.setId),
            ).then((found) => found.length),
          before: 0,
          after: 0,
        };
      },
    },
    add_competitor: {
      foreign: 'none',
      async arrange() {
        const t = await tenant();
        const names = () =>
          rows(
            db.selectFrom('competitors').select('name').where('project_id', '=', t.projectId),
          ).then((found) => found.map((row) => row.name));
        return {
          scope: t,
          payload: { name: 'Rival' },
          observe: names,
          before: [],
          after: ['Rival'],
        };
      },
    },
    review_competitor_suggestion: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const id = randomUUID();
        await db
          .insertInto('observed_entity_candidates')
          .values({
            id,
            workspace_id: t.workspaceId,
            project_id: t.projectId,
            audit_id: await fixtures.audit(t),
            name: 'Trail Co',
            kind: 'cited_domain',
            domain: 'trailco.example',
            citation_count: 2,
            engine_total: 2,
            qualification_reason: 'Cited across prompts and engines',
            prompt_count: 2,
            engine_count: 2,
            market_relevant: true,
            analyzer_version: 'observed-competitor-v1',
            source_analysis_ids: JSON.stringify([randomUUID()]),
            source_artifact_ids: JSON.stringify([]),
            status: 'pending',
            created_at: new Date(),
          })
          .execute();
        return {
          scope: t,
          payload: { suggestion_id: id, decision: 'reject' },
          observe: () =>
            one(
              db.selectFrom('observed_entity_candidates').select('status').where('id', '=', id),
            ).then((row) => row?.status),
          before: 'pending',
          after: 'rejected',
        };
      },
    },
    update_competitor: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const id = await fixtures.competitor(t.projectId, { name: 'Rival' });
        return {
          scope: t,
          payload: { competitor_id: id, name: 'Rival Co' },
          observe: () =>
            one(db.selectFrom('competitors').select('name').where('id', '=', id)).then(
              (row) => row?.name,
            ),
          before: 'Rival',
          after: 'Rival Co',
        };
      },
    },
    remove_competitor: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const id = await fixtures.competitor(t.projectId, { name: 'Rival' });
        return {
          scope: t,
          payload: { competitor_id: id },
          observe: () =>
            rows(db.selectFrom('competitors').select('id').where('id', '=', id)).then(
              (found) => found.length,
            ),
          before: 1,
          after: 0,
        };
      },
    },
    add_market: {
      foreign: 'none',
      async arrange() {
        const t = await tenant();
        return {
          scope: t,
          payload: { country_code: 'BR', language_code: 'pt' },
          observe: await markets(t),
          before: [],
          after: ['BR'],
        };
      },
    },
    remove_market: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const observe = await markets(t);
        const added = await addMarket(db, t, {
          country_code: 'BR',
          language_code: 'pt',
          label: '',
        });
        const id = added.find((market) => market.country_code === 'BR')!.id!;
        return { scope: t, payload: { market_id: id }, observe, before: ['BR'], after: [] };
      },
    },
    refresh_logos: {
      foreign: 'none',
      live: true,
      async arrange() {
        const t = await tenant();
        return {
          scope: t,
          payload: {},
          observe: () =>
            one(
              db.selectFrom('brands').select('logo_asset_id').where('project_id', '=', t.projectId),
            ).then((row) => row?.logo_asset_id),
          before: null,
          after: null,
        };
      },
    },
    launch_audit: {
      foreign: 422,
      async arrange() {
        const t = await tenant();
        return {
          scope: t,
          payload: { request: { prompt_set_id: t.setId, engines: ['chatgpt'] } },
          observe: () =>
            rows(
              db.selectFrom('audits').select('status').where('project_id', '=', t.projectId),
            ).then((found) => found.map((row) => row.status)),
          before: [],
          after: ['queued'],
        };
      },
    },
    cancel_audit: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const id = await queuedAudit(t);
        return {
          scope: t,
          payload: { audit_id: id },
          observe: () => auditStatus(id),
          before: 'queued',
          after: 'cancelled',
        };
      },
    },
    schedule: {
      foreign: 422,
      async arrange() {
        const t = await tenant();
        return {
          scope: t,
          payload: { schedule: { prompt_set_id: t.setId, cadence: 'daily', engines: ['chatgpt'] } },
          observe: () =>
            rows(
              db
                .selectFrom('audit_schedules')
                .select('cadence')
                .where('project_id', '=', t.projectId),
            ).then((found) => found.map((row) => row.cadence)),
          before: [],
          after: ['daily'],
        };
      },
    },
    rerun_audit_failures: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const id = await queuedAudit(t);
        await db
          .updateTable('audit_tasks')
          .set({ status: 'failed', error_code: 'provider_timeout' })
          .where('audit_id', '=', id)
          .execute();
        await db.updateTable('audits').set({ status: 'failed' }).where('id', '=', id).execute();
        return {
          scope: t,
          payload: { audit_id: id },
          observe: () =>
            rows(db.selectFrom('audits').select('trigger').where('parent_audit_id', '=', id)).then(
              (found) => found.map((row) => row.trigger),
            ),
          before: [],
          after: ['repair'],
        };
      },
    },
    update_audit_schedule: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const id = await schedule(t);
        return {
          scope: t,
          payload: { schedule_id: id, changes: { enabled: false } },
          observe: () =>
            one(db.selectFrom('audit_schedules').select('enabled').where('id', '=', id)).then(
              (row) => row?.enabled,
            ),
          before: true,
          after: false,
        };
      },
    },
    delete_audit_schedule: {
      foreign: 404,
      async arrange() {
        const t = await tenant();
        const id = await schedule(t);
        return {
          scope: t,
          payload: { schedule_id: id },
          observe: () =>
            rows(db.selectFrom('audit_schedules').select('id').where('id', '=', id)).then(
              (found) => found.length,
            ),
          before: 1,
          after: 0,
        };
      },
    },
  };
  return table;
}
