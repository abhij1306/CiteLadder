/** Visibility reads compose the canonical visibility owners; they own no metrics. */
import type { AnalyticsSelection } from '@citeladder/contracts/mcp-app';
import { visibilitySchema } from '@citeladder/contracts/visibility';
import { visibilityTrendListSchema } from '@citeladder/contracts/visibility-trends';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import type { Database } from '../db/database.ts';
import { parseDatetime } from '../http/datetimes.ts';
import { getVisibility, scopedSelection } from '../visibility/dashboard.ts';
import { getVisibilityEvidence } from '../visibility/evidence.ts';
import { getVisibilitySources } from '../visibility/sources.ts';
import { getSourceUrlDetail } from '../visibility/source-url.ts';
import { getVisibilityTrends } from '../visibility/trends.ts';
import { getPerception, getPerceptionQuotes } from '../visibility/perception.ts';
import { getAccuracy, getAccuracyClaims } from '../visibility/accuracy.ts';
import { getAds } from '../visibility/ads.ts';
import { policy } from '../config.ts';
import {
  AnalysisNotFoundError,
  authorizeRunSet,
  type RunSelection,
} from '../visibility/selection.ts';
import { siteSnapshot } from './evidence-site.ts';
import { appLink } from './links.ts';
import { pagination, reference, unavailable } from './data.ts';
import { McpInputError, type Evidence, type ProjectRead, type ReadScope } from './types.ts';
import { mcpPolicy } from './config.ts';

type Selection = {
  market_id?: string | null;
  audit_id?: string | null;
  engine?: string | null;
  cohort: string;
};
type Page = { cursor?: string | null; limit?: number | null };
const inMarket = (scope: ReadScope, args: Selection) => ({
  ...scope,
  marketId: args.market_id ?? null,
});
const runs = (scope: ReadScope, args: Selection): RunSelection => ({
  ...inMarket(scope, args),
  auditId: args.audit_id ?? null,
  auditIds: null,
  logicalEngine: args.engine ?? null,
  cohort: args.cohort,
  fromAt: null,
  toAt: null,
});

export async function visibilityTrends(
  { db, scope }: ProjectRead,
  args: Selection & {
    from_at: string;
    to_at: string;
    granularity: string;
    transport_model?: string | null;
    retrieval_enabled?: boolean | null;
  },
): Promise<Evidence> {
  const fromAt = parseDatetime(args.from_at);
  const toAt = parseDatetime(args.to_at);
  if (!fromAt || !toAt) throw new McpInputError('Trends window must contain valid datetimes');
  if (
    Date.parse(args.to_at) - Date.parse(args.from_at) >
    mcpPolicy.trend_max_window_days * 86400000
  )
    throw new McpInputError(`Trend windows are limited to ${mcpPolicy.trend_max_window_days} days`);
  const points = visibilityTrendListSchema.parse(
    await getVisibilityTrends(db, inMarket(scope, args), {
      logicalEngine: args.engine ?? null,
      fromAt,
      toAt,
      granularity: args.granularity,
      transportModel: args.transport_model ?? null,
      retrievalEnabled: args.retrieval_enabled ?? null,
      cohort: args.cohort,
    }),
  );
  if (!points.length) return { ...unavailable('no_measured_runs'), window: args };
  return {
    state: 'available',
    window: { from_at: args.from_at, to_at: args.to_at },
    points,
    artifact_refs: [...new Set(points.flatMap((p) => p.source_audit_ids ?? []))].map((id) =>
      reference('audit', id),
    ),
  };
}

/**
 * Answer perception for the latest or a chosen run: the summary (net
 * sentiment always with its coverage) or a page of verified quotes. Sources
 * in `drivers` were cited alongside criticism; they are never a cause.
 */
export async function perceptionRead(
  { db, scope }: ProjectRead,
  args: Selection &
    Page & {
      view: 'summary' | 'quotes';
      entity?: string | null;
      theme?: string | null;
      polarity?: 'positive' | 'negative' | null;
    },
): Promise<Evidence> {
  try {
    if (args.view === 'quotes') {
      const page = await getPerceptionQuotes(db, runs(scope, args), {
        entity: args.entity ?? null,
        theme: args.theme ?? null,
        polarity: args.polarity ?? null,
        cursor: args.cursor ?? null,
        limit: args.limit ?? mcpPolicy.default_list_limit,
      });
      return {
        state: 'available',
        view: 'quotes',
        items: page.items,
        pagination: pagination(page.items, page.next_cursor),
        artifact_refs: [...new Set(page.items.map((quote) => quote.run_id))].map((id) =>
          reference('audit', id),
        ),
      };
    }
    const summary = await getPerception(db, runs(scope, args));
    return {
      ...summary,
      perception_state: summary.state,
      state: 'available',
      view: 'summary',
      artifact_refs: summary.source_audit_ids.map((id) => reference('audit', id)),
    };
  } catch (error) {
    if (error instanceof AnalysisNotFoundError && !args.audit_id)
      return unavailable('no_completed_run');
    throw error;
  }
}

/**
 * Fact-check accuracy for the latest or a chosen run: the summary (accuracy
 * always with its coverage) or a page of claims with their verdicts and the
 * confirmed facts behind them.
 */
export async function factChecksRead(
  { db, scope }: ProjectRead,
  args: Selection &
    Page & {
      view: 'summary' | 'claims';
      topic?: string | null;
      verdict?: string | null;
    },
): Promise<Evidence> {
  try {
    if (args.view === 'claims') {
      const page = await getAccuracyClaims(db, runs(scope, args), {
        topic: args.topic ?? null,
        verdict: args.verdict ?? null,
        cursor: args.cursor ?? null,
        limit: args.limit ?? mcpPolicy.default_list_limit,
      });
      return {
        state: 'available',
        view: 'claims',
        items: page.items,
        pagination: pagination(page.items, page.next_cursor),
        artifact_refs: [...new Set(page.items.map((claim) => claim.run_id))].map((id) =>
          reference('audit', id),
        ),
      };
    }
    const summary = await getAccuracy(db, runs(scope, args));
    return {
      ...summary,
      accuracy_state: summary.state,
      state: 'available',
      view: 'summary',
      artifact_refs: summary.source_audit_ids.map((id) => reference('audit', id)),
    };
  } catch (error) {
    if (error instanceof AnalysisNotFoundError && !args.audit_id)
      return unavailable('no_completed_run');
    throw error;
  }
}

/**
 * Ads in ChatGPT Search answers for the latest or a chosen run: the same
 * summary as the Ads tab, creatives paged by cursor. Ads are paid placements,
 * reported apart from citations and never as a cause of visibility.
 */
export async function adsRead(
  { db, scope }: ProjectRead,
  args: Selection & Page,
): Promise<Evidence> {
  try {
    const summary = await getAds(db, runs(scope, args), {
      cursor: args.cursor ?? null,
      limit: Math.min(
        args.limit ?? policy.visibility.ads_creatives_default_limit,
        policy.visibility.ads_creatives_max_limit,
      ),
    });
    return {
      ...summary,
      ads_state: summary.state,
      state: 'available',
      pagination: pagination(summary.creatives.items, summary.creatives.next_cursor),
      artifact_refs: summary.source_audit_ids.map((id) => reference('audit', id)),
    };
  } catch (error) {
    if (error instanceof AnalysisNotFoundError && !args.audit_id)
      return unavailable('no_completed_run');
    throw error;
  }
}

/** The dashboard projection for one run, with that run's status and progress. */
export async function visibilityOverview(
  { db, scope, origin }: ProjectRead,
  args: Selection & { baseline_id?: string | null },
): Promise<Evidence> {
  try {
    if (args.baseline_id) await authorizeRunSet(db, scope, [args.baseline_id]);
    const projection = visibilitySchema.parse(
      await getVisibility(db, inMarket(scope, args), {
        auditId: args.audit_id ?? null,
        logicalEngine: args.engine ?? null,
        baselineId: args.baseline_id ?? null,
        selectionMode: args.audit_id ? 'run' : 'latest',
        fromAt: null,
        toAt: null,
        configurationKey: null,
        cohort: args.cohort,
      }),
    );
    const run = await new WorkspaceScope(scope.workspaceId)
      .selectFrom(db, 'audits')
      .select(['status', 'requested_count', 'completed_count', 'failed_count', 'completed_at'])
      .where('project_id', '=', scope.projectId)
      .where('id', '=', projection.audit_id)
      .executeTakeFirstOrThrow();
    return {
      state: 'available',
      ...projection,
      run: {
        status: run.status,
        prompts_requested: run.requested_count,
        answers_completed: run.completed_count,
        answers_failed: run.failed_count,
        completed_at: run.completed_at,
      },
      link: appLink(origin, `/runs/${projection.audit_id}`, scope.projectId),
      artifact_refs: [reference('audit', projection.audit_id)],
    };
  } catch (error) {
    if (error instanceof AnalysisNotFoundError && !args.audit_id && !args.baseline_id)
      return unavailable('no_completed_run');
    throw error;
  }
}

export async function visibilityResults(
  { db, scope }: ProjectRead,
  args: Selection &
    Page & { prompt_id?: string | null; domain?: string | null; url?: string | null },
): Promise<Evidence> {
  const page = await getVisibilityEvidence(db, runs(scope, args), {
    promptId: args.prompt_id ?? null,
    outcome: null,
    competitor: null,
    domain: args.domain ?? null,
    url: args.url ?? null,
    cursor: args.cursor ?? null,
    asOf: null,
    limit: args.limit ?? mcpPolicy.default_list_limit,
  });
  const items = page.items.map(
    ({
      analysis_id: _analysis,
      artifact_id: _artifact,
      prompt_snapshot_id: _snapshot,
      ...item
    }) => ({
      ...item,
      record_uri: `citeladder://visibility_result/${item.task_id}`,
    }),
  );
  return {
    state: 'available',
    observed_at: page.as_of,
    items,
    pagination: pagination(items, page.next_cursor ?? null, page.total ?? 0),
    artifact_refs: items.map((item) => reference('visibility_result', item.task_id)),
  };
}

export async function visibilitySources(
  { db, scope }: ProjectRead,
  args: Selection & Page & { level: 'domain' | 'url'; domain?: string | null },
): Promise<Evidence> {
  let selection: RunSelection;
  try {
    // One run, as the description promises: the named run or the market's latest.
    selection = await scopedSelection(db, runs(scope, args));
  } catch (error) {
    if (error instanceof AnalysisNotFoundError && !args.audit_id)
      return unavailable('no_completed_run');
    throw error;
  }
  const auditId = selection.auditId;
  if (auditId === null) throw new Error('A sources read selects exactly one run');
  const page = await getVisibilitySources(db, selection, {
    domain: args.domain ?? null,
    sourceClass: null,
    standing: null,
    dimension: args.level,
    asOf: null,
    cursor: args.cursor ?? null,
    limit: args.limit ?? mcpPolicy.default_list_limit,
    baselineAuditIds: null,
  });
  return {
    state: 'available',
    audit_id: auditId,
    level: args.level,
    coverage: { responses: page.responses, prompts: page.prompts, citations: page.total_citations },
    items: page.items,
    pagination: pagination(page.items, page.next_cursor, page.total),
    as_of: page.as_of,
    artifact_refs: [reference('audit', auditId)],
  };
}

export async function sourceUrl(
  { db, scope }: ProjectRead,
  args: Selection & { url: string },
): Promise<Evidence> {
  const detail = await getSourceUrlDetail(db, runs(scope, args), args.url);
  if (!detail.retrievals) return { ...unavailable('url_not_cited_in_selection'), url: args.url };
  return { state: 'available', ...detail };
}

function validateSelection(selection: AnalyticsSelection) {
  const { view } = selection;
  if (view === 'trends' && (!selection.from_at || !selection.to_at || selection.audit_id))
    throw new McpInputError('Trends requires an explicit window and no audit_id');
  if (
    view === 'site_health' &&
    (selection.audit_id || selection.engine || selection.competitor || selection.cohort !== 'core')
  )
    throw new McpInputError('Site Health does not support visibility filters');
  if (
    (selection.from_at ||
      selection.to_at ||
      selection.transport_model != null ||
      selection.retrieval_enabled != null) &&
    view !== 'trends'
  )
    throw new McpInputError('Period and model filters apply only to Trends');
  if ((selection.domain || selection.cursor || selection.level === 'url') && view !== 'sources')
    throw new McpInputError('Source paging filters apply only to Sources');
  if (selection.snapshot_id && view !== 'site_health')
    throw new McpInputError('snapshot_id applies only to Site Health');
  if (selection.competitor && view !== 'overview' && view !== 'trends')
    throw new McpInputError('Competitor selection applies only to Overview and Trends');
}

function validateCompetitor(selection: AnalyticsSelection, evidence: Evidence) {
  // Names must occur in canonical evidence; they select display, not new scoring.
  if (!selection.competitor || evidence.state !== 'available') return;
  const rankings = Array.isArray(evidence.rankings) ? evidence.rankings : [];
  const points = Array.isArray(evidence.points) ? evidence.points : [];
  const rows = [
    ...rankings,
    ...points.flatMap((p) =>
      p && typeof p === 'object' && 'rankings' in p && Array.isArray(p.rankings) ? p.rankings : [],
    ),
  ];
  if (
    !rows.some((r) => r && typeof r === 'object' && 'name' in r && r.name === selection.competitor)
  )
    throw new McpInputError('Competitor is absent from the selected evidence');
}

/** The interactive app's view: one selection resolved to concrete persisted evidence. */
export async function renderAnalytics(
  db: Database,
  scope: ReadScope,
  selection: AnalyticsSelection,
  origin: string,
): Promise<Evidence> {
  validateSelection(selection);
  const read = { db, scope, origin };
  const { view } = selection;
  const resolved = { ...selection };
  let evidence: Evidence;
  if (view === 'site_health') {
    evidence = await siteSnapshot(read, selection);
    if (typeof evidence.snapshot_id === 'string') resolved.snapshot_id = evidence.snapshot_id;
  } else if (view === 'trends') {
    evidence = await visibilityTrends(read, {
      ...selection,
      from_at: selection.from_at ?? '',
      to_at: selection.to_at ?? '',
      granularity: 'run',
    });
  } else {
    const overview = await visibilityOverview(read, selection);
    if (typeof overview.audit_id === 'string') resolved.audit_id = overview.audit_id;
    evidence =
      view === 'sources' && resolved.audit_id ? await visibilitySources(read, resolved) : overview;
  }
  validateCompetitor(selection, evidence);
  return {
    surface: 'citeladder_analytics',
    selection: resolved,
    evidence,
    links: {
      application: appLink(
        origin,
        view === 'site_health' ? '/site' : '/visibility',
        scope.projectId,
      ),
      onboarding: `${origin}/onboarding`,
    },
  };
}
