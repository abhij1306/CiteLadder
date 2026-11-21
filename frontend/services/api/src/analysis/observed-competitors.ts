import { randomUUID } from 'node:crypto';
import type { Selectable } from 'kysely';
import { subjectXactLock } from '../db/advisory-lock.ts';
import type { Database } from '../db/database.ts';
import type { Audits, ResponseAnalyses } from '../generated/db-schema.ts';
import { policy } from '../config.ts';
import type { ProjectScope } from '../projects/brand-profile.ts';
import { compareText } from '../text-order.ts';
import { domainMatches, normalizeDomain } from './domains.ts';
import type { ScoringConfig } from './scoring.ts';

const CITED = 'cited_domain';
export const NAMED = 'named_in_answers';

export function suggestionRows(db: Database, scope: ProjectScope) {
  return db
    .selectFrom('observed_entity_candidates')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId);
}

/**
 * Serializes the project's suggestion writes with its decisions, so a write
 * never misses a rejection committed while it ran. A decision takes it after
 * the project lock and before any candidate row.
 */
export function lockSuggestions(db: Database, scope: ProjectScope) {
  return subjectXactLock(db, `competitor-suggestions:${scope.projectId}`);
}

async function auditEngineTotal(
  db: Database,
  scope: ProjectScope & { auditId: string },
): Promise<number> {
  const row = await db
    .selectFrom('audit_tasks')
    .select((eb) => eb.fn.count<string>('logical_engine').distinct().as('engines'))
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('audit_id', '=', scope.auditId)
    .executeTakeFirstOrThrow();
  return Number(row.engines);
}

export async function persistObservedCompetitors(
  db: Database,
  audit: Selectable<Audits>,
  analyses: Selectable<ResponseAnalyses>[],
  config: ScoringConfig,
  at: Date,
) {
  const rules = policy.audits.observed_competitors;
  const scope = { workspaceId: audit.workspace_id, projectId: audit.project_id };
  await lockSuggestions(db, scope);
  const rejected = await suggestionRows(db, scope)
    .select('domain')
    .where('kind', '=', CITED)
    .where('status', '=', rules.status_rejected)
    .execute();
  const excluded = [
    ...rules.excluded_research_domains,
    ...config.ownedDomains,
    ...config.unintendedDomains,
    ...config.competitors.flatMap((c) => c.domains),
    ...rejected.flatMap((row) => (row.domain ? [row.domain] : [])),
  ].map(normalizeDomain);
  const byId = new Map(analyses.map((a) => [a.id, a]));
  const citations = await db
    .selectFrom('citations')
    .selectAll()
    .where('workspace_id', '=', audit.workspace_id)
    .where('audit_id', '=', audit.id)
    .where('classification', '=', 'third_party')
    .orderBy('domain')
    .orderBy('ordinal')
    .execute();
  const domains = new Map<string, Evidence & { citations: number }>();
  for (const citation of citations) {
    const domain = normalizeDomain(citation.domain),
      analysis = byId.get(citation.analysis_id);
    if (
      !domain ||
      !analysis ||
      !policy.visibility.organic_cohorts.includes(analysis.cohort) ||
      excluded.some((d) => domainMatches(domain, d))
    )
      continue;
    const value = domains.get(domain) ?? {
      citations: 0,
      prompts: new Set(),
      engines: new Set(),
      analyses: new Set(),
      artifacts: new Set(),
    };
    value.citations += 1;
    value.prompts.add(analysis.prompt_index);
    value.engines.add(analysis.logical_engine);
    value.analyses.add(analysis.id);
    value.artifacts.add(analysis.artifact_id);
    domains.set(domain, value);
  }
  const qualified = [...domains]
    .filter(
      ([, v]) =>
        v.prompts.size >= rules.min_distinct_prompts &&
        v.engines.size >= rules.min_distinct_engines,
    )
    .sort(
      ([a, av], [b, bv]) =>
        bv.prompts.size - av.prompts.size || bv.engines.size - av.engines.size || compareText(a, b),
    )
    .slice(0, rules.max_candidates_per_audit);
  if (!qualified.length) return;
  const engineTotal = await auditEngineTotal(db, { ...scope, auditId: audit.id });
  await db
    .insertInto('observed_entity_candidates')
    .values(
      qualified.map(([domain, value]) => ({
        id: randomUUID(),
        workspace_id: audit.workspace_id,
        project_id: audit.project_id,
        audit_id: audit.id,
        kind: CITED,
        domain,
        name_key: null,
        citation_count: value.citations,
        engine_total: engineTotal,
        name: domain
          .split('.')[0]!
          .replaceAll('-', ' ')
          .replaceAll(/\b\w/gu, (c) => c.toUpperCase()),
        qualification_reason:
          'Repeatedly cited across market-specific prompts and answer engines. Product overlap and geographic relevance require human verification.',
        prompt_count: value.prompts.size,
        engine_count: value.engines.size,
        market_relevant: false,
        status: rules.status_pending,
        analyzer_version: rules.analyzer_version,
        source_analysis_ids: JSON.stringify([...value.analyses].sort(compareText)),
        source_artifact_ids: JSON.stringify([...value.artifacts].sort(compareText)),
        created_at: at,
      })),
    )
    .execute();
}

export type Evidence = {
  prompts: Set<number>;
  engines: Set<string>;
  analyses: Set<string>;
  artifacts: Set<string>;
};

export async function upsertNamedCandidates(
  db: Database,
  scope: ProjectScope & { auditId: string },
  candidates: readonly { key: string; name: string; seen: Evidence }[],
) {
  const rules = policy.audits.observed_competitors;
  const engineTotal = await auditEngineTotal(db, scope);
  const at = new Date();
  await db
    .insertInto('observed_entity_candidates')
    .values(
      candidates.map(({ key, name, seen }) => ({
        id: randomUUID(),
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        audit_id: scope.auditId,
        kind: NAMED,
        domain: null,
        name_key: key,
        name,
        qualification_reason:
          'Named without being tracked across market-specific prompts and answer engines. Product overlap and geographic relevance require human verification.',
        prompt_count: seen.prompts.size,
        engine_count: seen.engines.size,
        engine_total: engineTotal,
        citation_count: null,
        market_relevant: false,
        status: rules.status_pending,
        analyzer_version: rules.named.analyzer_version,
        source_analysis_ids: JSON.stringify([...seen.analyses].sort(compareText)),
        source_artifact_ids: JSON.stringify([...seen.artifacts].sort(compareText)),
        created_at: at,
      })),
    )
    .onConflict((conflict) =>
      conflict.columns(['audit_id', 'name_key']).doUpdateSet((eb) => ({
        name: eb.ref('excluded.name'),
        prompt_count: eb.ref('excluded.prompt_count'),
        engine_count: eb.ref('excluded.engine_count'),
        engine_total: eb.ref('excluded.engine_total'),
        source_analysis_ids: eb.ref('excluded.source_analysis_ids'),
        source_artifact_ids: eb.ref('excluded.source_artifact_ids'),
      })),
    )
    .execute();
}
