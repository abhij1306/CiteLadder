/** Compose the overview from existing persisted owners; this read acquires nothing. */
import { commandCenterSchema } from '@citeladder/contracts/opportunities';
import { sql, type Selectable } from 'kysely';
import type { z } from 'zod';

import { frozenComparisonKey } from '../analysis/comparison.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import type { Audits } from '../generated/db-schema.ts';
import { listOpportunities } from '../opportunities/reads.ts';
import { getRunVisibility, type VisibilityResponse } from '../visibility/dashboard.ts';
import { compareText } from '../text-order.ts';
import type { ProjectScope } from './brand-profile.ts';
import { readProject } from './service.ts';

type View = z.input<typeof commandCenterSchema>;
type Audit = Selectable<Audits>;
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
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('status', 'in', policy.visibility.dashboard_audit_statuses)
    .where('audit_scope', '=', policy.visibility.brand_audit_scope)
    .orderBy('completed_at', 'desc')
    .orderBy('id', 'desc');
  const [latest, chosen] = await Promise.all([
    // The overview follows the default market; a chosen run brings its own.
    query.where('market_id', 'is', null).limit(1).executeTakeFirst(),
    auditId ? query.where('id', '=', auditId).executeTakeFirst() : undefined,
  ]);
  const selected = auditId ? chosen : latest;
  if (!selected) {
    if (auditId) throw notFound('Completed command-center measurement');
    return null;
  }
  const audits = await query
    .where('market_id', 'is not distinct from', selected.market_id)
    .where(sql<boolean>`coalesce(completed_at, created_at) <= ${new Date(instant(selected))}`)
    .limit(policy.projects.command_center_max_audits)
    .execute();
  if (!audits.some((audit) => audit.id === selected.id)) audits.push(selected);
  const ids = audits.map((audit) => audit.id);
  const engines = await db
    .selectFrom('audit_engine_snapshots')
    .select(['audit_id', 'logical_engine'])
    .where('audit_id', 'in', ids)
    .execute();
  const prompts = await db
    .selectFrom('audit_prompt_snapshots')
    .select(['audit_id', 'prompt_id', 'text'])
    .where('audit_id', 'in', ids)
    .where('cohort', '=', 'core')
    .execute();
  const engineNames = (id: string) =>
    [
      ...new Set(engines.filter((row) => row.audit_id === id).map((row) => row.logical_engine)),
    ].sort(compareText);
  const identities = new Map<string, string>();
  const identity = (audit: Audit) => {
    const cached = identities.get(audit.id);
    if (cached) return cached;
    const key = JSON.stringify([
      frozenComparisonKey(audit.configuration) || audit.id,
      audit.analyzer_version,
      audit.benchmark_mode,
      engineNames(audit.id),
      [
        ...new Set(
          prompts
            .filter((row) => row.audit_id === audit.id)
            .map((row) => row.prompt_id ?? `text:${row.text}`),
        ),
      ].sort(compareText),
    ]);
    identities.set(audit.id, key);
    return key;
  };
  const key = identity(selected);
  const previous =
    audits.find(
      (audit) =>
        audit.id !== selected.id && instant(audit) < instant(selected) && identity(audit) === key,
    ) ?? null;
  return {
    selected,
    previous,
    engines: engineNames(selected.id),
    historical: selected.id !== latest?.id,
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
function metrics(
  current: VisibilityResponse | null,
  previous: VisibilityResponse | null,
): View['state'] {
  const brand = current?.rankings.find((row) => row.is_brand);
  const prior = previous?.rankings.find((row) => row.is_brand);
  // With no share of voice (nobody named) the sort order is alphabetical, not a rank.
  const rankOf = (view: VisibilityResponse | null, row: typeof brand) =>
    view && row?.share_of_voice != null ? view.rankings.indexOf(row) + 1 : null;
  const rank = rankOf(current, brand);
  const priorRank = rankOf(previous, prior);
  return {
    // Visibility is the share of answers naming the brand, as on the Visibility page.
    visibility: {
      value: percent(current?.visibility_rate),
      delta: delta(percent(current?.visibility_rate), percent(previous?.visibility_rate)),
    },
    share_of_voice: {
      value: percent(brand?.share_of_voice),
      delta: delta(percent(brand?.share_of_voice), percent(prior?.share_of_voice)),
    },
    brand_rank: { value: rank, delta: delta(rank, priorRank) },
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
/**
 * The one step that most moves AI visibility next. Measurement comes first,
 * because nothing else can be judged without it: prompts, then the first
 * audit (or the one under way), then the top Action, then the site crawl and
 * the search integrations that sharpen later Actions.
 */
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
      href: action.action_id ? `/agent/actions/${action.action_id}` : '/agent/actions',
      opportunity_id: action.id,
    };
  if (!crawled) return step('crawl', 'Run the first site crawl', '/site');
  if (!connected) return step('connect', 'Connect GSC or GA4', '/settings?tab=integrations');
  return step('monitor', 'No open Action — watch the trend', '/visibility?tab=trends');
}
async function loopEvidence(db: Database, scope: ProjectScope) {
  const mapping = await db
    .selectFrom('integration_property_mappings')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('status', '=', 'active')
    .orderBy('updated_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  const crawl = await db
    .selectFrom('site_crawls')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('status', 'in', ['completed', 'partially_completed'])
    .orderBy('completed_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  const demand = await db
    .selectFrom('demand_snapshots')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .orderBy('window_end', 'desc')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  const snapshot = await db
    .selectFrom('opportunity_snapshots')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
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
async function resolvedActions(
  db: Database,
  scope: ProjectScope,
  audits: Awaited<ReturnType<typeof comparableAudits>>,
): Promise<View['resolved_actions']> {
  let query = db
    .selectFrom('actions')
    .innerJoin('opportunity_implementation_events as impl', 'impl.action_id', 'actions.id')
    .innerJoin(
      'opportunity_verification_events as verified',
      'verified.implementation_event_id',
      'impl.id',
    )
    .select([
      'actions.id',
      'actions.target_label',
      sql<Date>`min(verified.created_at)`.as('resolved_at'),
      sql<string>`(array_agg(impl.id order by verified.created_at, verified.id))[1]`.as(
        'implementation_id',
      ),
      sql<string>`(array_agg(verified.id order by verified.created_at, verified.id))[1]`.as(
        'verification_id',
      ),
    ])
    .where('actions.workspace_id', '=', scope.workspaceId)
    .where('actions.project_id', '=', scope.projectId)
    .where('impl.workspace_id', '=', scope.workspaceId)
    .where('impl.project_id', '=', scope.projectId)
    .where('verified.workspace_id', '=', scope.workspaceId)
    .where('verified.project_id', '=', scope.projectId)
    .where('verified.observation_kind', '=', 'verified')
    .groupBy(['actions.id', 'actions.target_label'])
    .orderBy('resolved_at', 'desc');
  if (audits?.previous)
    query = query.having(
      sql<Date>`min(verified.created_at)`,
      '>',
      audits.previous.completed_at ?? audits.previous.created_at,
    );
  if (audits)
    query = query.having(
      sql<Date>`min(verified.created_at)`,
      '<=',
      audits.selected.completed_at ?? audits.selected.created_at,
    );
  const rows = await query.execute();
  return {
    since_audit_id: audits?.previous?.id ?? null,
    count: rows.length,
    titles: rows.slice(0, 5).map((row) => row.target_label),
    evidence: rows.slice(0, 5).map((row) => ({
      action_id: row.id,
      implementation_event_ids: [row.implementation_id],
      verification_event_ids: [row.verification_id],
    })),
  };
}
function trackLimitations(
  audits: Awaited<ReturnType<typeof comparableAudits>>,
  previous: VisibilityResponse | null,
) {
  if (!audits) return ['No visibility audit has run yet.'];
  return previous ? [] : ['No comparable prior audit is available.'];
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
  // The project read authorizes the scope before anything else is read.
  const project = await readProject(db, scope);
  const audits = await comparableAudits(db, scope, auditId);
  // Independent reads of persisted state, issued together.
  const [
    current,
    previous,
    opportunities,
    order,
    profile,
    { mapping, crawl, demand, implementation },
    counted,
    inFlight,
  ] = await Promise.all([
    visibility(db, scope, audits?.selected ?? null),
    visibility(db, scope, audits?.previous ?? null),
    listOpportunities(
      db,
      scope,
      { type: null, severity: null, status: null, rule_id: null, min_priority: null },
      { limit: 8, cursor: null },
    ),
    db
      .selectFrom('opportunity_orders')
      .select('version')
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .executeTakeFirst(),
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
    // Only the first audit's progress is a next action; a tracked project skips the read.
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
  ]);
  const count = Number(counted.count);
  const times = [crawl?.completed_at, demand?.created_at].filter((at): at is Date => at != null);
  const analyzedAt = times.length ? new Date(Math.max(...times.map((at) => at.getTime()))) : null;
  const currentBrand = current?.rankings.find((row) => row.is_brand);
  const priorBrand = previous?.rankings.find((row) => row.is_brand);
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
        crawl && !demand ? ['Search Demand is not connected or has not refreshed yet.'] : [],
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
      citation_share: {
        value: percent(currentBrand?.citation_rate),
        delta: delta(percent(currentBrand?.citation_rate), percent(priorBrand?.citation_rate)),
      },
      engine_coverage: audits?.engines.length ?? 0,
      observed_at: audits ? instant(audits.selected) : null,
      limitations: trackLimitations(audits, previous),
    },
    measurement: await measurement(db, scope, audits),
    state: metrics(current, previous),
    movements: movements(current, previous),
    actions: opportunities.items,
    action_order_version: order?.version ?? 0,
    resolved_actions: await resolvedActions(db, scope, audits),
    report_available: Boolean(audits),
    stale: audits?.historical ?? false,
  };
}
function projectSchemaStrings(value: unknown) {
  return commandCenterSchema.shape.facts.shape.products_services.parse(value);
}
