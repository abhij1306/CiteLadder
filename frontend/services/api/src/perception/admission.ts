import { createHash } from 'node:crypto';

import { factTopicSchema, type FactTopic } from '@citeladder/contracts/fact-checking';
import type { Transaction } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import { factTopicOrder } from '../config/perception.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import type { DB } from '../generated/db-schema.ts';
import { enqueueTask } from '../queue/enqueue.ts';
import { namesAnyEntity } from './passages.ts';

const versionsSchema = z.object({
  extractor_version: z.string().min(1),
  template_version: z.string().min(1),
  metrics_version: z.string().min(1),
  // The gateway model at admission (empty when none was configured): the audit
  // is classified by this model or not at all, so its results never mix models.
  model: z.string(),
});
export type PerceptionVersions = z.infer<typeof versionsSchema>;

const factCheckSchema = z.object({
  claims_version: z.string().min(1),
  verify_template_version: z.string().min(1),
  metrics_version: z.string().min(1),
  fact_set_hash: z.string().min(1),
  facts: z.array(z.object({ revision_id: z.uuid(), topic: factTopicSchema })).min(1),
  related_topics: z.record(z.string(), z.array(factTopicSchema)),
});
export type FrozenFactCheck = z.infer<typeof factCheckSchema>;

export function factScope(factCheck: FrozenFactCheck, topic: FactTopic): FactTopic[] {
  return [topic, ...(factCheck.related_topics[topic] ?? [])];
}

export function checkedTopics(factCheck: FrozenFactCheck): ReadonlySet<FactTopic> {
  const withFacts = new Set(factCheck.facts.map((fact) => fact.topic));
  return new Set(
    factTopicSchema.options.filter((topic) =>
      factScope(factCheck, topic).some((scoped) => withFacts.has(scoped)),
    ),
  );
}

export function admittedPerceptionVersions(input: {
  auditScope: string;
  factCheck: FrozenFactCheck | null;
  model: string;
}): PerceptionVersions | null {
  if (input.auditScope !== policy.visibility.brand_audit_scope) return null;
  const { extractor_version, template_version, metrics_version } = policy.perception;
  return {
    extractor_version,
    template_version: input.factCheck
      ? `${template_version}+${input.factCheck.claims_version}`
      : template_version,
    metrics_version,
    model: input.model,
  };
}

export async function admittedFactCheck(
  db: Database,
  input: { workspaceId: string; projectId: string; auditScope: string },
): Promise<FrozenFactCheck | null> {
  if (input.auditScope !== policy.visibility.brand_audit_scope) return null;
  const settings = policy.perception.fact_check;
  const rows = await db
    .selectFrom('brand_facts as fact')
    .innerJoin('brand_fact_revisions as revision', (join) =>
      join
        .onRef('revision.fact_id', '=', 'fact.id')
        .onRef('revision.revision', '=', 'fact.revision')
        .onRef('revision.workspace_id', '=', 'fact.workspace_id'),
    )
    .select(['revision.id', 'fact.topic', 'fact.created_at'])
    .where('fact.workspace_id', '=', input.workspaceId)
    .where('fact.project_id', '=', input.projectId)
    .where('fact.status', '=', 'confirmed')
    .orderBy('fact.created_at')
    .orderBy('fact.id')
    .execute();
  const facts = rows
    .flatMap((row) => {
      const topic = factTopicSchema.safeParse(row.topic);
      return topic.success && factTopicOrder.has(topic.data)
        ? [{ revision_id: row.id, topic: topic.data }]
        : [];
    })
    .sort((a, b) => (factTopicOrder.get(a.topic) ?? 0) - (factTopicOrder.get(b.topic) ?? 0))
    .slice(0, settings.max_frozen_facts);
  if (!facts.length) return null;
  const ids = facts.map((fact) => fact.revision_id).sort();
  return {
    claims_version: settings.claims_version,
    verify_template_version: settings.verify_template_version,
    metrics_version: settings.metrics_version,
    fact_set_hash: createHash('sha256').update(ids.join(',')).digest('hex'),
    facts,
    related_topics: settings.related_topics,
  };
}

export function frozenFactCheck(configuration: unknown): FrozenFactCheck | null {
  const parsed = factCheckSchema.safeParse(record(configuration).fact_check);
  return parsed.success ? parsed.data : null;
}

export function frozenPerceptionVersions(configuration: unknown): PerceptionVersions | null {
  const parsed = versionsSchema.safeParse(record(configuration).perception);
  return parsed.success ? parsed.data : null;
}

export async function enqueuePerception(
  db: Database | Transaction<DB>,
  input: {
    workspaceId: string;
    projectId: string;
    configuration: unknown;
    analysisId: string;
    assessments: readonly { state: string }[];
  },
): Promise<string | null> {
  const versions = frozenPerceptionVersions(input.configuration);
  if (!versions || !namesAnyEntity(input.assessments)) return null;
  return enqueueTask(db, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    kind: policy.perception.task_kind,
    payload: { analysis_id: input.analysisId },
    keyParts: [input.analysisId, versions.extractor_version],
    maxAttempts: policy.perception.task_max_attempts,
  });
}
