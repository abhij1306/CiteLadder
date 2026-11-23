import { comparisonBasis, type ComparedAnswers } from '@citeladder/contracts/comparison-reason';
import { commandCenterSchema } from '@citeladder/contracts/opportunities';
import { sql, type Selectable } from 'kysely';
import type { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import type { Audits } from '../generated/db-schema.ts';
import { listOpportunities, readOpportunityOrder } from '../opportunities/reads.ts';
import { currentSiteCrawl } from '../site-health/reads/crawl.ts';
import { persistedBaseline, type VisibilityComparison } from '../visibility/comparison.ts';
import {
  getRunComparison,
  getRunVisibility,
  type VisibilityResponse,
} from '../visibility/dashboard.ts';
import type { RankingRow } from '../visibility/metrics.ts';
import { latestBrandRunId } from '../visibility/selection.ts';
import { compareText } from '../text-order.ts';
import type { ProjectScope } from './brand-profile.ts';
import { readProject } from './service.ts';

type View = z.input<typeof commandCenterSchema>;
const AUDIT_COLUMNS = ['id', 'completed_at', 'created_at', 'benchmark_mode'] as const;
type Audit = Pick<Selectable<Audits>, (typeof AUDIT_COLUMNS)[number]>;
const instant = (audit: Audit) => (audit.completed_at ?? audit.created_at).toISOString();
const percent = (value: number | null | undefined) =>
  value == null ? null : Math.round(value * 10000) / 100;
const delta = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? null : Math.round((a - b) * 100) / 100;
function state(
  at: Date | string | null,
  coverage: string[],
  limitations: string[],
  partial = false,
  freshness: 'current' | 'unknown' = 'unknown',
): View['loop']['connected'] {
  const observed = at instanceof Date ? at.toISOString() : at;
  const observedState = partial ? 'partial' : 'observed';
  return {
    state: observed ? observedState : 'not_run',
    observed_at: observed,
    freshness: observed ? freshness : 'unknown',
    coverage: observed ? coverage : [],
    limitations,
  };
}
async function comparableAudits(db: Database, scope: ProjectScope, auditId: string | null) {
  const query = db
    .selectFrom('audits')
    .select(AUDIT_COLUMNS)
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('status', 'in', policy.visibility.dashboard_audit_statuses)
    .where('audit_scope', '=', policy.visibility.brand_audit_scope);
  const latestId = await latestBrandRunId(db, { ...scope, marketId: null });
  const selectedId = auditId ?? latestId;
  const selected = selectedId
    ? await query.where('id', '=', selectedId).executeTakeFirst()
    : undefined;
  if (!selected) {
    if (auditId) throw notFound('Completed command-center measurement');
    return null;
  }
  const [engines, baseline] = await Promise.all([
    db
      .selectFrom('audit_engine_snapshots')
      .select('logical_engine')
      .distinct()
      .where('audit_id', '=', selected.id)
      .execute(),
    persistedBaseline(
      db,
      { auditId: selected.id, workspaceId: scope.workspaceId },
      { cohort: policy.visibility.core_cohort, engine: null },
    ),
  ]);
  const comparisonStatus = baseline?.status ?? 'baseline_pending';
  const previousId =
    comparisonStatus === 'comparable' ? (baseline?.baseline_audit_id ?? null) : null;
  const previous = previousId
    ? ((await query.where('id', '=', previousId).executeTakeFirst()) ?? null)
    : null;
  return {
    selected,
    previous,
    comparisonStatus,
    skippedRuns: baseline?.skipped_runs ?? 0,
    engines: engines.map((row) => row.logical_engine).sort(compareText),
    historical: selected.id !== latestId,
  };
}
async function visibility(
  db: Database,
  scope: ProjectScope,
  audit: Audit | null,
): Promise<VisibilityResponse | null> {
  if (!audit) return null;
  return getRunVisibility(db, scope, audit.id, policy.visibility.core_cohort);
}
type ChangeSide = { visibility_rate?: number | null; rankings: RankingRow[] };
type Change = { after: ChangeSide; before: ChangeSide } | null;
async function sharedChange(
  db: Database,
  scope: ProjectScope,
  audits: Awaited<ReturnType<typeof comparableAudits>>,
): Promise<VisibilityComparison | null> {
  if (audits?.comparisonStatus !== 'matched_subset') return null;
  const comparison = await getRunComparison(db, scope, {
    auditId: audits.selected.id,
    cohort: policy.visibility.core_cohort,
  });
  return comparison.status === 'matched_subset' ? comparison : null;
}
function changeOf(
  current: VisibilityResponse | null,
  previous: VisibilityResponse | null,
  shared: VisibilityComparison | null,
): Change {
  if (current && previous) return { after: current, before: previous };
  if (!shared) return null;
  return {
    after: { visibility_rate: shared.current_values.visibility, rankings: shared.current_rankings },
    before: { visibility_rate: shared.baseline_values.visibility, rankings: shared.rankings },
  };
}
const answersOf = (shared: VisibilityComparison | null): ComparedAnswers | null =>
  shared ? { matched: shared.matched_cells, total: shared.current_cells } : null;
const withAnswers = (
  measured: View['measurement'],
  answers: ComparedAnswers | null,
): View['measurement'] => measured && { ...measured, comparison_answers: answers };
const brandOf = (side: ChangeSide | undefined) => side?.rankings.find((row) => row.is_brand);
const rankOf = (side: ChangeSide | undefined) => {
  const row = brandOf(side);
  return side && row?.share_of_voice != null ? side.rankings.indexOf(row) + 1 : null;
};
function citationShare(brand: RankingRow | undefined, change: Change) {
  return {
    value: percent(brand?.citation_rate),
    delta: delta(
      percent(brandOf(change?.after)?.citation_rate),
      percent(brandOf(change?.before)?.citation_rate),
    ),
  };
}
function metrics(current: VisibilityResponse | null, change: Change): View['state'] {
  const brand = brandOf(current ?? undefined);
  const after = brandOf(change?.after);
  const before = brandOf(change?.before);
  return {
    visibility: {
      value: percent(current?.visibility_rate),
      delta: delta(percent(change?.after.visibility_rate), percent(change?.before.visibility_rate)),
    },
    share_of_voice: {
      value: percent(brand?.share_of_voice),
      delta: delta(percent(after?.share_of_voice), percent(before?.share_of_voice)),
    },
    brand_rank: {
      value: rankOf(current ?? undefined),
      delta: delta(rankOf(change?.after), rankOf(change?.before)),
    },
  };
}
function movements(
  current: VisibilityResponse | null,
  previous: VisibilityResponse | null,
): View['movements'] {
  if (!previous || !current) return [];
  return current.per_engine
    .flatMap((row) => {
      const prior = previous.per_engine.find((item) => item.logical_engine === row.logical_engine);
      const a = percent(row.brand_mention_rate);
      const b = percent(prior?.brand_mention_rate);
      const change = delta(a, b);
      return change == null || change === 0
        ? []
        : [
            {
              label: row.logical_engine,
              direction: change > 0 ? 'positive' : 'negative',
              current: a,
              previous: b,
              delta: change,
            },
          ];
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 4);
}
function nextAction({
  actions,
  promptCount,
  tracked,
  inFlightAuditId,
  crawled,
  connected,
}: Readonly<{
  actions: View['actions'];
  promptCount: number;
  tracked: boolean;
  inFlightAuditId: string | null;
  crawled: boolean;
  connected: boolean;
}>): View['next_action'] {
  const step = (kind: View['next_action']['kind'], title: string, href: string) => ({
    kind,
    title,
    href,
    opportunity_id: null,
  });
  if (promptCount === 0)
    return step('configure_prompts', 'Choose the prompts to track', '/prompts');
  if (!tracked && inFlightAuditId)
    return step(
      'audit_running',
      'Your first visibility audit is running',
      `/runs/${inFlightAuditId}`,
    );
  if (!tracked) return step('audit', 'Run the first visibility audit', '/runs');
  const action = actions[0];
  if (action)
    return {
      kind: 'opportunity',
      title: action.title,
      href: action.action_id ? `/actions/${action.action_id}` : '/actions',
      opportunity_id: action.id,
    };
  if (!crawled) return step('crawl', 'Run the first site crawl', '/site');
  if (!connected) return step('connect', 'Connect GSC or GA4', '/settings?tab=integrations');
  return step('monitor', 'No open Action — watch the trend', '/insights');
}
async function loopEvidence(db: Database, scope: ProjectScope) {
  const [mapping, crawl, demand, snapshot] = await Promise.all([
    db
      .selectFrom('integration_property_mappings')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('status', '=', 'active')
      .orderBy('updated_at', 'desc')
      .limit(1)
      .executeTakeFirst(),
    currentSiteCrawl(db, scope.workspaceId, scope.projectId),
    db
      .selectFrom('demand_snapshots')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .orderBy('window_end', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst(),
    db
      .selectFrom('opportunity_snapshots')
      .select('id')
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst(),
  ]);
  const implementation = snapshot
    ? await db
        .selectFrom('opportunity_implementation_events')
        .select('declared_implemented_at')
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('opportunity_snapshot_id', '=', snapshot.id)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst()
    : null;
  return { mapping, crawl, demand, implementation };
}
function trackLimitations(
  audits: Awaited<ReturnType<typeof comparableAudits>>,
  change: Change,
  answers: ComparedAnswers | null,
) {
  if (!audits) return ['No visibility audit has run yet.'];
  const basis = comparisonBasis({
    status: audits.comparisonStatus,
    skippedRuns: audits.skippedRuns,
    answers,
  });
  switch (basis.kind) {
    case 'comparable':
      return change ? [] : ['The earlier run could not be read.'];
    case 'matched_subset':
      return change ? [basis.note] : ['The comparison with an earlier run could not be read.'];
    case 'declined':
      return [basis.reason];
    default: {
      const unreachable: never = basis;
      return unreachable;
    }
  }
}
async function measurement(
  db: Database,
  scope: ProjectScope,
  audits: Awaited<ReturnType<typeof comparableAudits>>,
): Promise<View['measurement']> {
  if (!audits) return null;
  const snapshot = await db
    .selectFrom('metric_snapshots')
    .select(['id', 'analyzer_version', 'scoring_rule_version'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('audit_id', '=', audits.selected.id)
    .executeTakeFirstOrThrow();
  return {
    audit_id: audits.selected.id,
    completed_at: instant(audits.selected),
    benchmark_mode: audits.selected.benchmark_mode,
    logical_engines: audits.engines,
    comparable_audit_id: audits.previous?.id ?? null,
    comparison_status: audits.comparisonStatus,
    metric_snapshot_id: snapshot.id,
    analyzer_version: snapshot.analyzer_version,
    scoring_rule_version: snapshot.scoring_rule_version,
  };
}
export async function commandCenter(
  db: Database,
  scope: ProjectScope,
  auditId: string | null,
): Promise<View> {
  const project = await readProject(db, scope);
  const audits = await comparableAudits(db, scope, auditId);
  const order = readOpportunityOrder(db, scope);
  const [
    current,
    previous,
    opportunities,
    persistedOrder,
    profile,
    { mapping, crawl, demand, implementation },
    counted,
    inFlight,
    measured,
    shared,
  ] = await Promise.all([
    visibility(db, scope, audits?.selected ?? null),
    visibility(db, scope, audits?.previous ?? null),
    order.then((persisted) =>
      listOpportunities(
        db,
        scope,
        { type: null, severity: null, status: null, rule_id: null, min_priority: null },
        { limit: policy.projects.overview_opportunity_rows, cursor: null },
        { order: persisted },
      ),
    ),
    order,
    db
      .selectFrom('brand_profiles')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .executeTakeFirst(),
    loopEvidence(db, scope),
    db
      .selectFrom('prompts')
      .innerJoin('prompt_sets', 'prompt_sets.id', 'prompts.prompt_set_id')
      .innerJoin('projects', 'projects.id', 'prompt_sets.project_id')
      .select(sql<string>`count(*)`.as('count'))
      .where('projects.workspace_id', '=', scope.workspaceId)
      .where('projects.id', '=', scope.projectId)
      .where('prompts.status', '=', 'active')
      .where('prompts.enabled', '=', true)
      .executeTakeFirstOrThrow(),
    audits
      ? undefined
      : db
          .selectFrom('audits')
          .select('id')
          .where('workspace_id', '=', scope.workspaceId)
          .where('project_id', '=', scope.projectId)
          .where('audit_scope', '=', policy.visibility.brand_audit_scope)
          .where('status', 'in', policy.visibility.in_flight_audit_statuses)
          .orderBy('created_at', 'desc')
          .limit(1)
          .executeTakeFirst(),
    measurement(db, scope, audits),
    sharedChange(db, scope, audits),
  ]);
  const change = changeOf(current, previous, shared);
  const answers = answersOf(shared);
  const count = Number(counted.count);
  const times = [crawl?.completed_at, demand?.created_at].filter((at): at is Date => at != null);
  const analyzedAt = times.length ? new Date(Math.max(...times.map((at) => at.getTime()))) : null;
  const currentBrand = current?.rankings.find((row) => row.is_brand);
  return {
    project: {
      id: project.id,
      name: project.name,
      brand_name: project.brand_name,
      website_url: project.website_url,
    },
    facts: {
      industry: project.industry,
      description: profile?.description ?? '',
      positioning: profile?.positioning ?? '',
      target_audience: profile?.target_audience ?? '',
      products_services: projectSchemaStrings(profile?.products_services ?? []),
      competitors: project.competitors.map((row) => ({
        id: row.id,
        name: row.name,
        domains: row.domains,
      })),
    },
    loop: {
      connected: state(
        mapping?.updated_at ?? null,
        mapping ? [mapping.provider] : [],
        mapping ? [] : ['No GSC or GA4 property is connected.'],
        false,
        'current',
      ),
      analyzed: state(
        analyzedAt,
        [...(crawl ? ['site_health'] : []), ...(demand ? ['search_demand'] : [])],
        crawl && !demand ? ['Demand is not connected or has not refreshed yet.'] : [],
        Boolean(crawl) !== Boolean(demand),
      ),
      acted: state(
        implementation?.declared_implemented_at ?? null,
        implementation ? ['current_opportunity_cycle'] : [],
        implementation
          ? []
          : ['No implementation is declared for the current opportunity snapshot.'],
      ),
      tracked: state(
        audits ? instant(audits.selected) : null,
        audits?.engines ?? [],
        audits ? [] : ['No visibility audit has run yet.'],
        false,
        audits?.historical ? 'unknown' : 'current',
      ),
    },
    active_prompt_count: count,
    next_action: nextAction({
      actions: opportunities.items,
      promptCount: count,
      tracked: Boolean(audits),
      inFlightAuditId: inFlight?.id ?? null,
      crawled: Boolean(crawl),
      connected: Boolean(mapping),
    }),
    track: {
      citation_share: citationShare(currentBrand, change),
      engine_coverage: audits?.engines.length ?? 0,
      observed_at: audits ? instant(audits.selected) : null,
      limitations: trackLimitations(audits, change, answers),
    },
    measurement: withAnswers(measured, answers),
    state: metrics(current, change),
    movements: movements(current, previous),
    actions: opportunities.items,
    action_order_version: persistedOrder?.version ?? 0,
    report_available: Boolean(audits),
    stale: audits?.historical ?? false,
  };
}
function projectSchemaStrings(value: unknown) {
  return commandCenterSchema.shape.facts.shape.products_services.parse(value);
}
