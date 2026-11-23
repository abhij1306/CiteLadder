import { visibilityCohortSchema } from '@citeladder/contracts/visibility';
import { logicalEngines, surfaceKindOf } from '../config/providers.ts';
import { policy } from '../config.ts';
import { getMarketVisibility } from '../visibility/markets.ts';
import { getRankedVisibility } from '../visibility/ranking-sentiment.ts';
import { getSourceMovers } from '../visibility/source-movers.ts';
import { getSourceNearMisses } from '../visibility/source-retrieval.ts';
import { getSourceSeries, SOURCE_SERIES_MAX_SERIES } from '../visibility/source-series.ts';
import { surfaceRates } from '../visibility/surface.ts';
import type { RunSelection } from '../visibility/selection.ts';
import { mcpPolicy } from './config.ts';
import { cursorOffset, offsetPage, reference, unavailable } from './data.ts';
import {
  dashboardQuery,
  inMarket,
  notYetMeasured,
  oneRun,
  requireTopic,
  runs,
  type Page,
  type Selection,
} from './evidence-analytics.ts';
import { withoutQuery } from './evidence-site.ts';
import { McpInputError, type Evidence, type ProjectRead } from './types.ts';

type Level = 'domain' | 'url';
function runId(selection: RunSelection) {
  if (selection.auditId === null) throw new Error('A view of one run selects exactly one run');
  return selection.auditId;
}
const keyOf = (level: Level, key: string) => (level === 'url' ? withoutQuery(key) : key);

export async function sourceNearMisses(read: ProjectRead, args: Selection & Page) {
  const run = await oneRun(read, args);
  if (run.kind === 'none') return run.evidence;
  const { selection } = run;
  const auditId = runId(selection);
  const limit = args.limit ?? mcpPolicy.default_list_limit;
  const key = ['near_misses', auditId];
  const offset = cursorOffset(args.cursor, key);
  const found = await getSourceNearMisses(read.db, selection, {
    asOf: new Date().toISOString(),
    limit: offset + limit + 1,
  });
  const coverage = {
    answers_with_retrieval: found.responses,
    engines_without_retrieval: found.unavailable_engines,
  };
  if (!found.responses)
    return { ...unavailable('retrieval_not_observed'), audit_id: auditId, coverage };
  const { items, pagination } = offsetPage(
    found.items.map(({ url_hash: _hash, ...item }) => ({ ...item, url: withoutQuery(item.url) })),
    { offset, limit, selection: key },
  );
  return {
    state: 'available',
    view: 'near_misses',
    audit_id: auditId,
    coverage,
    items,
    pagination,
    artifact_refs: [reference('audit', auditId)],
  };
}

export async function sourceMovers(read: ProjectRead, args: Selection & Page & { level: Level }) {
  const run = await oneRun(read, args);
  if (run.kind === 'none') return run.evidence;
  const { selection } = run;
  const auditId = runId(selection);
  let comparison;
  try {
    ({ comparison } = await getRankedVisibility(read.db, inMarket(read.scope, args), {
      ...dashboardQuery({ ...args, audit_id: auditId }),
      baselineId: null,
    }));
  } catch (error) {
    return notYetMeasured(error, Boolean(args.audit_id));
  }
  if (comparison?.status !== 'comparable')
    return { ...unavailable(comparison?.status ?? 'no_baseline'), audit_id: auditId };
  const movers = await getSourceMovers(read.db, selection, {
    dimension: args.level,
    baselineAuditIds: comparison.baseline_audit_ids,
    limit: Math.min(
      args.limit ?? policy.visibility.source_movers_default_limit,
      policy.visibility.source_movers_max_limit,
    ),
  });
  if (movers.comparison_status !== 'comparable')
    return { ...unavailable(movers.comparison_status), audit_id: auditId };
  const strip = (rows: typeof movers.risers) =>
    rows.map((row) => ({ ...row, key: keyOf(args.level, row.key) }));
  return {
    state: 'available',
    view: 'movers',
    audit_id: auditId,
    baseline_audit_ids: comparison.baseline_audit_ids,
    level: args.level,
    citations: { current: movers.current_citations, baseline: movers.previous_citations },
    risers: strip(movers.risers),
    fallers: strip(movers.fallers),
    artifact_refs: [auditId, ...comparison.baseline_audit_ids].map((id) => reference('audit', id)),
  };
}

export async function sourceSeries(
  read: ProjectRead,
  args: Selection &
    Page & { level: Level; domain?: string | null; granularity: 'day' | 'week' | 'month' },
) {
  await requireTopic(read, args.topic_id);
  let found;
  try {
    found = await getSourceSeries(read.db, runs(read.scope, args), {
      dimension: args.level,
      granularity: args.granularity,
      domain: args.domain ?? null,
      sourceClass: null,
      limit: SOURCE_SERIES_MAX_SERIES,
    });
  } catch (error) {
    return notYetMeasured(error, Boolean(args.audit_id));
  }
  if (!found.buckets.length)
    return unavailable(
      args.topic_id || args.engine || args.audit_id
        ? 'no_answers_in_selection'
        : 'no_completed_run',
    );
  const key = ['series', args.level, args.granularity, args.domain ?? ''];
  const newest = found.buckets.map((at, index) => ({ at, index })).toReversed();
  const { items, pagination } = offsetPage(newest, {
    offset: cursorOffset(args.cursor, key),
    limit: args.limit ?? mcpPolicy.default_list_limit,
    selection: key,
  });
  return {
    state: 'available',
    view: 'series',
    level: args.level,
    granularity: args.granularity,
    buckets: items.map(({ at, index }) => ({ at, answers: found.bucket_responses[index] })),
    series: found.series.map((row) => ({
      key: keyOf(args.level, row.key),
      citations: row.citations,
      points: items.map(({ index }) => row.points[index]),
    })),
    pagination,
    artifact_refs: [],
  };
}

const searchSurfaces = logicalEngines.filter((engine) => surfaceKindOf(engine) === 'search_ai');

export async function surfaceRatesView(read: ProjectRead, args: Selection) {
  if (args.topic_id) throw new McpInputError('topic_id does not apply to view surface');
  if (args.engine && surfaceKindOf(args.engine) !== 'search_ai')
    return unavailable('not_applicable');
  const run = await oneRun(read, args);
  if (run.kind === 'none') return run.evidence;
  const auditId = runId(run.selection);
  const engines = await Promise.all(
    (args.engine ? [args.engine] : searchSurfaces).map((logicalEngine) =>
      surfaceRates(read.db, {
        ...read.scope,
        marketId: args.market_id ?? null,
        auditId,
        auditIds: null,
        cohort: args.cohort,
        logicalEngine,
      }),
    ),
  );
  return {
    state: 'available',
    view: 'surface',
    audit_id: auditId,
    engines: engines.map(({ competitor_mention_rates, ...rates }) => ({
      ...rates,
      competitor_mention_rates: competitor_mention_rates.map(({ name, rate }) => ({ name, rate })),
    })),
    artifact_refs: [reference('audit', auditId)],
  };
}

export async function marketHeadlines(read: ProjectRead, args: Selection): Promise<Evidence> {
  if (args.market_id || args.audit_id || args.engine)
    throw new McpInputError(
      "view markets reads every market's latest run; omit market_id, audit_id and engine",
    );
  await requireTopic(read, args.topic_id);
  const result = await getMarketVisibility(
    read.db,
    { ...read.scope, topicId: args.topic_id ?? null },
    visibilityCohortSchema.parse(args.cohort),
  );
  return {
    state: 'available',
    view: 'markets',
    ...result,
    artifact_refs: result.markets.flatMap((row) =>
      row.audit_id ? [reference('audit', row.audit_id)] : [],
    ),
  };
}
