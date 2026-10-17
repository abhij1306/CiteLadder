import { randomUUID } from 'node:crypto';
import type { Selectable } from 'kysely';
import type { Database } from '../db/database.ts';
import type { Audits, ResponseAnalyses } from '../generated/db-schema.ts';
import { policy } from '../config.ts';
import { compareText } from '../text-order.ts';
import { domainMatches, normalizeDomain } from './domains.ts';
import type { ScoringConfig } from './scoring.ts';

/** Repeated third-party citations create review candidates, never tracked competitors. */
export async function persistObservedCompetitors(
  db: Database,
  audit: Selectable<Audits>,
  analyses: Selectable<ResponseAnalyses>[],
  config: ScoringConfig,
  at: Date,
) {
  const rules = policy.audits.observed_competitors;
  const excluded = [
    ...rules.excluded_research_domains,
    ...config.ownedDomains,
    ...config.unintendedDomains,
    ...config.competitors.flatMap((c) => c.domains),
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
  const domains = new Map<
    string,
    { prompts: Set<number>; engines: Set<string>; analyses: Set<string>; artifacts: Set<string> }
  >();
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
      prompts: new Set(),
      engines: new Set(),
      analyses: new Set(),
      artifacts: new Set(),
    };
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
  await db
    .insertInto('observed_entity_candidates')
    .values(
      qualified.map(([domain, value]) => ({
        id: randomUUID(),
        workspace_id: audit.workspace_id,
        project_id: audit.project_id,
        audit_id: audit.id,
        domain,
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
