/**
 * Perception versions frozen at audit admission, and the enqueue that follows
 * an analysis. The frozen versions decide whether an audit is perceived at
 * all: only brand audits freeze them, and an audit without them is never
 * classified and never reads as pending.
 *
 * A brand audit in a fact-checking pilot workspace with confirmed facts also
 * freezes `fact_check`: the claim and verification versions and the exact
 * confirmed fact revisions it checks against. Its perception template version
 * then names the claims addendum too, so its results never pool with plain
 * perception under one version.
 */
import { createHash } from 'node:crypto';

import { factTopicSchema, type FactTopic } from '@citeladder/contracts/fact-checking';
import type { Transaction } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import { factTopicOrder } from '../config/perception.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import type { DB } from '../generated/db-schema.ts';
import { enqueueTask } from '../referrals/enqueue.ts';
import { namesAnyEntity } from './passages.ts';

const versionsSchema = z.object({
  extractor_version: z.string().min(1),
  template_version: z.string().min(1),
  metrics_version: z.string().min(1),
});
export type PerceptionVersions = z.infer<typeof versionsSchema>;

const factCheckSchema = z.object({
  claims_version: z.string().min(1),
  verify_template_version: z.string().min(1),
  metrics_version: z.string().min(1),
  // SHA-256 of the sorted revision ids: equal fact sets compare equal.
  fact_set_hash: z.string().min(1),
  facts: z.array(z.object({ revision_id: z.uuid(), topic: factTopicSchema })).min(1),
  // The related-topic map in force at admission; later config never rewrites a read.
  related_topics: z.record(z.string(), z.array(factTopicSchema)),
});
export type FrozenFactCheck = z.infer<typeof factCheckSchema>;

/** The topics a claim on `topic` is checked against: its own, then its frozen neighbours. */
export function factScope(factCheck: FrozenFactCheck, topic: FactTopic): FactTopic[] {
  return [topic, ...(factCheck.related_topics[topic] ?? [])];
}

/** The claim topics with at least one frozen fact in scope; any other claim is not covered. */
export function checkedTopics(factCheck: FrozenFactCheck): ReadonlySet<FactTopic> {
  const withFacts = new Set(factCheck.facts.map((fact) => fact.topic));
  return new Set(
    factTopicSchema.options.filter((topic) =>
      factScope(factCheck, topic).some((scoped) => withFacts.has(scoped)),
    ),
  );
}

/** What a new audit freezes: the versions in force now, for a brand audit only. */
export function admittedPerceptionVersions(
  auditScope: string,
  factCheck: FrozenFactCheck | null = null,
): PerceptionVersions | null {
  if (auditScope !== policy.visibility.brand_audit_scope) return null;
  const { extractor_version, template_version, metrics_version } = policy.perception;
  return {
    extractor_version,
    template_version: factCheck
      ? `${template_version}+${factCheck.claims_version}`
      : template_version,
    metrics_version,
  };
}

/**
 * The fact-check a new brand audit freezes: the newest revision of each
 * confirmed fact, topic-ordered and capped. Null outside the pilot, for
 * other scopes, or when the project has no confirmed fact.
 */
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

/** The audit's frozen fact-check, or null for an audit outside the pilot. */
export function frozenFactCheck(configuration: unknown): FrozenFactCheck | null {
  const parsed = factCheckSchema.safeParse(record(configuration).fact_check);
  return parsed.success ? parsed.data : null;
}

/** The audit's frozen versions, or null for an audit that is not perceived. */
export function frozenPerceptionVersions(configuration: unknown): PerceptionVersions | null {
  const parsed = versionsSchema.safeParse(record(configuration).perception);
  return parsed.success ? parsed.data : null;
}

/**
 * Queue one classification for a perceived answer that names the brand or a
 * competitor. Runs inside the analysis transaction; no network I/O here. The
 * key holds the extractor version, so a re-derived finalize never adds a row.
 */
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
