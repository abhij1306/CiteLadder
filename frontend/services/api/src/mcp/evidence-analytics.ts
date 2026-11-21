import {
  analyticsAppPath,
  type AnalyticsSelection,
  type McpVisibilityResults,
  type McpVisibilitySources,
} from '@citeladder/contracts/mcp-app';
import { visibilitySchema } from '@citeladder/contracts/visibility';
import { visibilityTrendListSchema } from '@citeladder/contracts/visibility-trends';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import type { Database } from '../db/database.ts';
import { parseDatetime } from '../http/datetimes.ts';
import { scopedSelection, topicBlock } from '../visibility/dashboard.ts';
import { getVisibilityMatrix } from '../visibility/matrix.ts';
import { getRankedVisibility } from '../visibility/ranking-sentiment.ts';
import { getVisibilityTopics } from '../visibility/topics.ts';
import { getVisibilityEvidence } from '../visibility/evidence.ts';
import { getVisibilitySources } from '../visibility/sources.ts';
import { getSourceUrlDetail } from '../visibility/source-url.ts';
import { getVisibilityTrends } from '../visibility/trends.ts';
import { getPerception, getPerceptionQuotes } from '../visibility/perception.ts';
import { getAccuracy, getAccuracyClaims, getAccuracyFacts } from '../visibility/accuracy.ts';
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

export type Selection = {
  market_id?: string | null;
  audit_id?: string | null;
  engine?: string | null;
  cohort: string;
  topic_id?: string | null;
};
export type Page = { cursor?: string | null; limit?: number | null };
const inMarket = (scope: ReadScope, args: Selection) => ({
  ...scope,
  marketId: args.market_id ?? null,
  topicId: args.topic_id ?? null,
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

/** A topic filter names one of this project's topics; an ID alone authorizes nothing. */
async function requireTopic({ db, scope }: ProjectRead, topicId: string | null | undefined) {
  if (!topicId) return;
  const topic = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'topics')
    .select('id')
    .where('project_id', '=', scope.projectId)
    .where('id', '=', topicId)
    .executeTakeFirst();
  if (!topic) throw new McpInputError('topic_id is not a topic of this project');
}

export function notYetMeasured(error: unknown, named: boolean, ranRun = false): Evidence {
  if (!(error instanceof AnalysisNotFoundError)) throw error;
  if (ranRun && error.reason === 'not_measured') return unavailable('topic_not_measured');
  if (named) throw error;
  return unavailable(error.reason === 'metrics_pending' ? 'metrics_pending' : 'no_completed_run');
}

export async function visibilityTrends(
  read: ProjectRead,
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
  await requireTopic(read, args.topic_id);
  const { db, scope } = read;
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
    return notYetMeasured(error, Boolean(args.audit_id));
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
      view: 'summary' | 'claims' | 'facts';
      topic?: string | null;
      verdict?: string | null;
    },
): Promise<Evidence> {
  try {
    if (args.view === 'facts') {
      const list = await getAccuracyFacts(db, runs(scope, args));
      if (!list.enabled) return unavailable('not_enabled');
      return {
        state: 'available',
        view: 'facts',
        facts: list.facts,
        artifact_refs: [],
      };
    }
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
    return notYetMeasured(error, Boolean(args.audit_id));
  }
}

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
    return notYetMeasured(error, Boolean(args.audit_id));
  }
}

type OverviewArgs = Selection & {
  baseline_id?: string | null;
  view?: 'summary' | 'topics' | 'matrix';
};

const dashboardQuery = (args: Selection) =>
  ({
    auditId: args.audit_id ?? null,
    logicalEngine: args.engine ?? null,
    selectionMode: args.audit_id ? 'run' : 'latest',
    fromAt: null,
    toAt: null,
    configurationKey: null,
    cohort: args.cohort,
  }) as const;

export async function visibilityOverview(read: ProjectRead, args: OverviewArgs): Promise<Evidence> {
  const { db, scope } = read;
  const query = dashboardQuery(args);
  const named = Boolean(args.audit_id || args.baseline_id);
  let topicInRun = false;
  try {
    await requireTopic(read, args.topic_id);
    if (args.view === 'topics' || args.view === 'matrix') {
      if (args.baseline_id) throw new McpInputError('baseline_id applies only to view summary');
      const projection =
        args.view === 'topics'
          ? await getVisibilityTopics(db, inMarket(scope, args), query)
          : await getVisibilityMatrix(db, inMarket(scope, args), query);
      return {
        state: 'available',
        view: args.view,
        ...projection,
        artifact_refs: projection.source_audit_ids.map((id) => reference('audit', id)),
      };
    }
    if (args.baseline_id) await authorizeRunSet(db, scope, [args.baseline_id]);
    if (args.topic_id && !named) await scopedSelection(db, runs(scope, args));
    topicInRun = Boolean(args.topic_id);
    const projection = visibilitySchema.parse(
      await getRankedVisibility(db, inMarket(scope, args), {
        ...query,
        baselineId: args.baseline_id ?? null,
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
      link: appLink(read.origin, `/runs/${projection.audit_id}`, scope.projectId),
      artifact_refs: [reference('audit', projection.audit_id)],
    };
  } catch (error) {
    return notYetMeasured(error, named, topicInRun);
  }
}

export async function oneRun(
  read: ProjectRead,
  args: Selection,
): Promise<{ kind: 'run'; selection: RunSelection } | { kind: 'none'; evidence: Evidence }> {
  await requireTopic(read, args.topic_id);
  let ran = false;
  try {
    const selection = await scopedSelection(read.db, runs(read.scope, args));
    ran = true;
    // An empty page would read as zero; a topic the run never asked is not measured.
    if (args.topic_id && selection.auditId) {
      const { workspaceId } = read.scope;
      await topicBlock(read.db, {
        workspaceId,
        auditId: selection.auditId,
        topicId: args.topic_id,
      });
    }
    return { kind: 'run', selection };
  } catch (error) {
    return { kind: 'none', evidence: notYetMeasured(error, Boolean(args.audit_id), ran) };
  }
}

export async function visibilityResults(
  read: ProjectRead,
  args: Selection &
    Page & { prompt_id?: string | null; domain?: string | null; url?: string | null },
): Promise<Evidence> {
  const { db } = read;
  const run = await oneRun(read, args);
  if (run.kind === 'none') return run.evidence;
  const { selection } = run;
  const page = await getVisibilityEvidence(db, selection, {
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
    audit_id: selection.auditId,
    observed_at: page.as_of,
    items,
    pagination: pagination(items, page.next_cursor ?? null, page.total ?? 0),
    artifact_refs: items.map((item) => reference('visibility_result', item.task_id)),
  } satisfies McpVisibilityResults & Evidence;
}

export async function visibilitySources(
  read: ProjectRead,
  args: Selection & Page & { level: 'domain' | 'url'; domain?: string | null },
): Promise<Evidence> {
  const { db } = read;
  const run = await oneRun(read, args);
  if (run.kind === 'none') return run.evidence;
  const { selection } = run;
  const auditId = selection.auditId;
  if (auditId === null) throw new Error('A sources read selects exactly one run');
  let page: Awaited<ReturnType<typeof getVisibilitySources>>;
  try {
    page = await getVisibilitySources(db, selection, {
      domain: args.domain ?? null,
      sourceClass: null,
      standing: null,
      dimension: args.level,
      asOf: null,
      cursor: args.cursor ?? null,
      limit: args.limit ?? mcpPolicy.default_list_limit,
      baselineAuditIds: null,
    });
  } catch (error) {
    return notYetMeasured(error, Boolean(args.audit_id));
  }
  return {
    state: 'available',
    audit_id: auditId,
    level: args.level,
    coverage: { responses: page.responses, prompts: page.prompts, citations: page.total_citations },
    items: page.items,
    pagination: pagination(page.items, page.next_cursor, page.total),
    as_of: page.as_of,
    artifact_refs: [reference('audit', auditId)],
  } satisfies McpVisibilitySources & Evidence;
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
    const overview = await visibilityOverview(read, { ...selection, view: 'summary' });
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
      application: appLink(origin, analyticsAppPath(view), scope.projectId),
      onboarding: `${origin}/onboarding`,
    },
  };
}
