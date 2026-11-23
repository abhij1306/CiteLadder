import { randomUUID } from 'node:crypto';

import { createApp } from '../src/app.ts';
import { sessionToken, TEST_SESSION_COOKIE, testConfig, testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

export const VERSIONS = {
  extractor_version: 'perception-extract-test',
  template_version: 'perception-template-test',
  metrics_version: 'perception-metrics-test',
  model: 'test',
};
export const CONFIGURATION = {
  brand_name: 'Acme',
  competitors: [{ name: 'Rival', domains: [] }],
  perception: VERSIONS,
};
export const SUPPORT = randomUUID();
export const PRICING = randomUUID();

export type Body = Record<string, unknown>;

export const aspect = (polarity: string, quote: string, start = 0) => ({
  theme_id: SUPPORT as string | null,
  polarity,
  quote,
  start,
  end: start + quote.length,
});

type Entity = {
  name: string;
  kind: 'brand' | 'competitor';
  state?: string;
  label?: string;
  confidence?: number;
  aspects?: {
    theme_id: string | null;
    attribute?: string | null;
    polarity: string;
    quote: string;
    start: number;
    end: number;
  }[];
};

export function perceptionReads() {
  const config = testConfig();
  const db = testDatabase(config);
  const fixtures = new VisibilityFixtures(db);
  const app = createApp(config, db);
  async function get(tenant: Tenant, path: string, query: Record<string, string> = {}) {
    const token = await sessionToken({ sub: tenant.userId, ver: 0 });
    const search = new URLSearchParams(query);
    const response = await app.request(`${path}${search.size ? `?${search}` : ''}`, {
      headers: { cookie: `${TEST_SESSION_COOKIE}=${token}` },
    });
    return { status: response.status, body: (await response.json()) as Body };
  }

  async function answer(
    tenant: Tenant,
    auditId: string,
    input: {
      entities: Entity[];
      outcome?: string;
      reason?: string;
      citations?: string[];
      engine?: string;
      cohort?: string;
    },
  ) {
    const { taskId, analysisId } = await fixtures.execution(tenant, {
      auditId,
      engine: input.engine,
      cohort: input.cohort,
      promptText: 'best tools?',
      theme: 'Tools',
      analysis: { citations: (input.citations ?? []).map((url) => ({ url })) },
    });
    await db
      .updateTable('response_analyses')
      .set({
        entity_assessments: JSON.stringify(
          input.entities.map((entity) => ({
            entity_id: `${entity.kind}:${entity.name.toLowerCase()}`,
            entity_name: entity.name,
            entity_kind: entity.kind,
            state: entity.state ?? 'mentioned',
          })),
        ),
      })
      .where('id', '=', analysisId!)
      .execute();
    if (!input.outcome) return taskId;
    const analysis = await db
      .selectFrom('response_analyses')
      .select(['artifact_id'])
      .where('id', '=', analysisId!)
      .executeTakeFirstOrThrow();
    const perceptionId = randomUUID();
    await db
      .insertInto('answer_perceptions')
      .values({
        id: perceptionId,
        workspace_id: tenant.workspaceId,
        project_id: tenant.projectId,
        audit_id: auditId,
        task_id: taskId,
        analysis_id: analysisId!,
        artifact_id: analysis.artifact_id,
        extractor_version: VERSIONS.extractor_version,
        template_version: VERSIONS.template_version,
        outcome: input.outcome,
        outcome_reason: input.reason ?? null,
        created_at: new Date(),
      })
      .execute();
    const labelled = input.entities.filter((entity) => entity.label);
    if (labelled.length)
      await db
        .insertInto('entity_sentiments')
        .values(
          labelled.map((entity) => ({
            id: randomUUID(),
            workspace_id: tenant.workspaceId,
            perception_id: perceptionId,
            entity_id: `${entity.kind}:${entity.name.toLowerCase()}`,
            entity_name: entity.name,
            entity_kind: entity.kind,
            label: entity.label!,
            confidence: entity.confidence ?? 0.9,
            low_confidence: (entity.confidence ?? 0.9) < 0.6,
            passage_spans: JSON.stringify([]),
            aspects: JSON.stringify(entity.aspects ?? []),
          })),
        )
        .execute();
    return taskId;
  }

  async function themes(tenant: Tenant, rows: [id: string, name: string][]) {
    await db
      .insertInto('project_themes')
      .values(
        rows.map(([id, name], position) => ({
          id,
          workspace_id: tenant.workspaceId,
          project_id: tenant.projectId,
          name,
          position,
          source: 'user',
          created_at: new Date(),
          updated_at: new Date(),
        })),
      )
      .execute();
  }

  return { db, fixtures, get, answer, themes };
}
