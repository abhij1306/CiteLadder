/**
 * The observed Google AI Overview surface: one execution, or one selection.
 *
 * `executionSurfaceEvidence` reads mentioned, linked and cited from three
 * independent tables and never derives them from one another. `surfaceRates`
 * excludes failed and pending observations from every denominator and counts
 * them separately; an LLM engine gets no rates at all.
 */
import { sql } from 'kysely';

import {
  brandMentionRateWhenPresent,
  competitorMentionRate,
  countObservations,
  overallBrandVisibility,
  ownedCitationRateWhenPresent,
  triggerRate,
  type AioRate,
} from '../analysis/aio-rates.ts';
import { brandPosition, competitorPosition } from '../analysis/position.ts';
import { classifyCitation, scoringConfig } from '../analysis/scoring.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { wireUtcOrNull, utcText } from '../db/timestamps.ts';
import { authorizeRunSet, isLogicalEngine, selectedCohorts, unknownEngine } from './selection.ts';
import { compareText } from '../text-order.ts';

type JsonObject = Record<string, unknown>;

type AioLinkEvidence = { url: string; domain: string; title: string; element_index: number };

type SurfaceEntityEvidence = {
  name: string;
  kind: 'brand' | 'competitor';
  mentioned: boolean;
  linked: boolean;
  cited: boolean;
  first_offset: number | null;
  mention_order: number | null;
};

export type SearchSurfaceEvidence = {
  outcome: string;
  aio_present: boolean | null;
  aio_serp_position: number | null;
  provider_status_code: number | null;
  error_code: string;
  element_count: number;
  reference_count: number;
  location_code: number;
  language_code: string;
  device: string;
  observed_at: string | null;
  retrieved_at: string | null;
  links: AioLinkEvidence[];
  entities: SurfaceEntityEvidence[];
};

/** The scored answer an observation's entities are composed from. */
export type ScoredAnalysis = {
  id: string;
  brand_mentioned: boolean;
  brand_first_offset: number | null;
  score: unknown;
};

/** A stored score object; absent keeps its own meaning and corrupt data fails loudly. */
function asObject(value: unknown): JsonObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonObject;
  throw new TypeError('stored score is not an object');
}

async function composedEntities(
  db: Database,
  workspaceId: string,
  analysis: ScoredAnalysis | null,
  links: readonly AioLinkEvidence[],
  auditId: string,
): Promise<SurfaceEntityEvidence[]> {
  const audit = await db
    .selectFrom('audits')
    .select('configuration')
    .where('id', '=', auditId)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();
  // No analysis means no answer was ever scored: nothing to compose.
  if (analysis === null || audit === undefined) return [];
  const config = scoringConfig(audit.configuration);
  // Mentions, links and citations stand on their own rows; the score only
  // orders competitors, so an absent score or offset map means no order.
  const score: JsonObject = analysis.score === null ? {} : asObject(analysis.score);
  const firstOffsets = score.competitor_first_offsets;
  const offsets = firstOffsets === undefined || firstOffsets === null ? {} : asObject(firstOffsets);
  const citations = await db
    .selectFrom('citations')
    .select(['is_owned', 'matched_competitor'])
    .where('analysis_id', '=', analysis.id)
    .where('workspace_id', '=', workspaceId)
    .execute();
  const cited = new Set(
    citations.flatMap((row) => (row.matched_competitor ? [row.matched_competitor] : [])),
  );
  const mentioned = new Set(
    (
      await db
        .selectFrom('competitor_mentions')
        .select('competitor_name')
        .where('analysis_id', '=', analysis.id)
        .where('workspace_id', '=', workspaceId)
        .execute()
    ).map((row) => row.competitor_name),
  );
  // Links are classified by the scorer's own rule, so a link and a reference
  // to the same host cannot disagree about who owns it.
  let brandLinked = false;
  const linked = new Set<string>();
  for (const link of links) {
    const classified = classifyCitation({ url: link.url, domain: link.domain }, config);
    brandLinked ||= classified.is_owned;
    if (classified.matched_competitor) linked.add(classified.matched_competitor);
  }
  const offsetOf = (name: string) => (Object.hasOwn(offsets, name) ? offsets[name] : null);
  return [
    {
      name: config.brandName || 'Brand',
      kind: 'brand',
      mentioned: analysis.brand_mentioned,
      linked: brandLinked,
      cited: citations.some((row) => row.is_owned),
      first_offset: analysis.brand_first_offset,
      mention_order: brandPosition(analysis.brand_first_offset, offsets),
    },
    ...config.competitors.map((competitor) => ({
      name: competitor.name,
      kind: 'competitor' as const,
      mentioned: mentioned.has(competitor.name),
      linked: linked.has(competitor.name),
      cited: cited.has(competitor.name),
      first_offset: (offsetOf(competitor.name) as number | null | undefined) ?? null,
      mention_order: competitorPosition(score, competitor.name),
    })),
  ];
}

/**
 * The observed-surface evidence for one execution, or null when it has no
 * observation row (an LLM execution, or a search that never finished):
 * neither is a measured absence.
 */
export async function executionSurfaceEvidence(
  db: Database,
  input: { workspaceId: string; taskId: string; analysis: ScoredAnalysis | null },
): Promise<SearchSurfaceEvidence | null> {
  const observation = await db
    .selectFrom('aio_observations')
    .select([
      'id',
      'audit_id',
      'outcome',
      'aio_present',
      'aio_serp_position',
      'provider_status_code',
      'error_code',
      'element_count',
      'reference_count',
      'location_code',
      'language_code',
      'device',
      utcText(sql.ref('observed_at')).as('observed_at'),
      utcText(sql.ref('retrieved_at')).as('retrieved_at'),
    ])
    .where('task_id', '=', input.taskId)
    .where('workspace_id', '=', input.workspaceId)
    .executeTakeFirst();
  if (observation === undefined) return null;
  const links = (
    await db
      .selectFrom('aio_entity_links')
      .select(['url', 'domain', 'title', 'element_index'])
      .where('observation_id', '=', observation.id)
      .where('workspace_id', '=', input.workspaceId)
      .execute()
  ).sort(
    (left, right) => left.element_index - right.element_index || compareText(left.url, right.url),
  );
  return {
    outcome: observation.outcome,
    aio_present: observation.aio_present,
    aio_serp_position: observation.aio_serp_position,
    provider_status_code: observation.provider_status_code,
    error_code: observation.error_code,
    element_count: observation.element_count,
    reference_count: observation.reference_count,
    location_code: observation.location_code,
    language_code: observation.language_code,
    device: observation.device,
    observed_at: wireUtcOrNull(observation.observed_at),
    retrieved_at: wireUtcOrNull(observation.retrieved_at),
    links,
    entities: await composedEntities(
      db,
      input.workspaceId,
      input.analysis,
      links,
      observation.audit_id,
    ),
  };
}

type RateScope = {
  workspaceId: string;
  projectId: string;
  /** Without named runs, the market whose observations count; `null` is the default. */
  marketId: string | null;
  auditId: string | null;
  auditIds: string[] | null;
  cohort: string;
};

/**
 * Observations of the selection, with their analyses outer-joined: an inner
 * join would silently drop every observation CiteLadder failed to retrieve.
 * The cohort is read from the frozen prompt snapshot for the same reason.
 */
function scopedObservations(db: Database, scope: RateScope) {
  let query = db
    .selectFrom('aio_observations as observation')
    .innerJoin('audits as audit', 'audit.id', 'observation.audit_id')
    .innerJoin('audit_tasks as task', 'task.id', 'observation.task_id')
    .innerJoin('audit_prompt_snapshots as snapshot', (join) =>
      join
        .onRef('snapshot.audit_id', '=', 'observation.audit_id')
        .onRef('snapshot.prompt_index', '=', 'task.prompt_index'),
    )
    .leftJoin('response_analyses as ra', 'ra.task_id', 'observation.task_id')
    .where('observation.workspace_id', '=', scope.workspaceId)
    .where('audit.project_id', '=', scope.projectId)
    .where('snapshot.cohort', 'in', [...selectedCohorts(scope.cohort)]);
  if (scope.auditIds?.length) query = query.where('observation.audit_id', 'in', scope.auditIds);
  else if (scope.auditId !== null) query = query.where('observation.audit_id', '=', scope.auditId);
  else query = query.where('audit.market_id', 'is not distinct from', scope.marketId);
  return query;
}

export type SurfaceRatesResponse = {
  logical_engine: string;
  successful: number;
  with_overview: number;
  excluded: number;
  trigger_rate: AioRate;
  brand_mention_rate_when_present: AioRate;
  overall_brand_visibility: AioRate;
  owned_citation_rate_when_present: AioRate;
  competitor_mention_rates: { name: string; rate: AioRate }[];
};

const NO_RATE: AioRate = { numerator: 0, denominator: 0, denominator_kind: '', value: null };

/** The five labelled rates over one selection, each with its denominator. */
export async function surfaceRates(
  db: Database,
  scope: RateScope & { logicalEngine: string },
): Promise<SurfaceRatesResponse> {
  if (!isLogicalEngine(scope.logicalEngine)) throw unknownEngine(scope.logicalEngine);
  if (!policy.visibility.search_surface_engines.includes(scope.logicalEngine)) {
    return {
      logical_engine: scope.logicalEngine,
      successful: 0,
      with_overview: 0,
      excluded: 0,
      trigger_rate: NO_RATE,
      brand_mention_rate_when_present: NO_RATE,
      overall_brand_visibility: NO_RATE,
      owned_citation_rate_when_present: NO_RATE,
      competitor_mention_rates: [],
    };
  }
  // A single run is authorized exactly as a run set is: an unknown one is
  // not found, never zero-denominator rates.
  let runSet: string[] | null = null;
  if (scope.auditIds?.length) runSet = scope.auditIds;
  else if (scope.auditId !== null) runSet = [scope.auditId];
  await authorizeRunSet(db, scope, runSet);
  const observations = await scopedObservations(db, scope)
    .select([
      'observation.outcome',
      'observation.aio_present',
      'ra.brand_mentioned',
      'ra.owned_domain_cited',
    ])
    .execute();
  const counts = countObservations(
    observations.map((row) => [
      row.outcome,
      row.aio_present,
      Boolean(row.brand_mentioned),
      Boolean(row.owned_domain_cited),
    ]),
  );
  // Over DISTINCT observations, so a competitor named twice in one overview
  // cannot lift its own rate above the denominator.
  const competitors = await scopedObservations(db, scope)
    .innerJoin('competitor_mentions as mention', 'mention.analysis_id', 'ra.id')
    .where('observation.outcome', '=', policy.visibility.overview_present_outcome)
    .select([
      'mention.competitor_name',
      sql<string>`count(distinct observation.task_id)`.as('overviews'),
    ])
    .groupBy('mention.competitor_name')
    .execute();
  return {
    logical_engine: scope.logicalEngine,
    successful: counts.successful,
    with_overview: counts.with_overview,
    excluded: counts.excluded,
    trigger_rate: triggerRate(counts),
    brand_mention_rate_when_present: brandMentionRateWhenPresent(counts),
    overall_brand_visibility: overallBrandVisibility(counts),
    owned_citation_rate_when_present: ownedCitationRateWhenPresent(counts),
    competitor_mention_rates: competitors
      .map((row) => ({ name: String(row.competitor_name ?? ''), overviews: Number(row.overviews) }))
      .sort((left, right) => compareText(left.name, right.name))
      .map(({ name, overviews }) => ({ name, rate: competitorMentionRate(counts, overviews) })),
  };
}
