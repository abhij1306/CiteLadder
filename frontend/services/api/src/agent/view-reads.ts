import type { AgentView } from '@citeladder/contracts/agent-views';
import { aiTrafficOverview } from '../ai-traffic/overview.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { ApiError } from '../errors.ts';
import { parseDatetime } from '../http/datetimes.ts';
import { listMarkets } from '../projects/markets.ts';
import { datasetPage } from '../search-intelligence/reads.ts';
import { dashboard } from '../site-health/reads/dashboard.ts';
import { getRankedVisibility } from '../visibility/ranking-sentiment.ts';
import { AnalysisNotFoundError } from '../visibility/selection.ts';
import { getVisibilityTrends } from '../visibility/trends.ts';
import type { Scope } from './contracts.ts';

export type ViewRead =
  | { kind: 'available' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'invalid'; text: string };

const AVAILABLE: ViewRead = { kind: 'available' };
const DAY_MS = 86_400_000;
const presetDays: Readonly<Record<string, number>> = policy.analytics.preset_range_days;

type VisibilityView = Extract<AgentView, { market_id: string | null }>;

async function scopeProblem(db: Database, scope: Scope, view: VisibilityView) {
  if (view.market_id) {
    const markets = await listMarkets(db, scope);
    if (!markets.some((market) => market.id === view.market_id))
      return 'market_id is not a market of this project. Omit it for the project’s default market.';
  }
  if (view.topic_id) {
    const topic = await new WorkspaceScope(scope.workspaceId)
      .selectFrom(db, 'topics')
      .select('id')
      .where('project_id', '=', scope.projectId)
      .where('id', '=', view.topic_id)
      .executeTakeFirst();
    if (!topic) return 'topic_id is not a topic of this project. Omit it for every topic.';
  }
  return null;
}

function windowStart(range: string, now: Date) {
  const days = presetDays[range];
  if (days === undefined) return null;
  const from = new Date(now.getTime() - days * DAY_MS);
  from.setUTCHours(0, 0, 0, 0);
  return parseDatetime(from.toISOString());
}

async function measured(read: () => Promise<unknown>): Promise<ViewRead> {
  try {
    await read();
    return AVAILABLE;
  } catch (error) {
    if (error instanceof AnalysisNotFoundError)
      return { kind: 'unavailable', reason: error.reason };
    throw error;
  }
}

async function visibilityRead(
  db: Database,
  scope: Scope,
  view: VisibilityView,
  now: Date,
): Promise<ViewRead> {
  const problem = await scopeProblem(db, scope, view);
  if (problem) return { kind: 'invalid', text: problem };
  const runScope = { ...scope, marketId: view.market_id, topicId: view.topic_id };
  if (view.kind === 'visibility_trend') {
    const points = await getVisibilityTrends(db, runScope, {
      logicalEngine: null,
      fromAt: windowStart(view.range, now),
      toAt: null,
      granularity: 'run',
      transportModel: null,
      retrievalEnabled: null,
      cohort: 'core',
    });
    return points.length ? AVAILABLE : { kind: 'unavailable', reason: 'no_measured_runs' };
  }
  return measured(() =>
    getRankedVisibility(db, runScope, {
      auditId: null,
      logicalEngine: null,
      baselineId: null,
      selectionMode: 'latest',
      fromAt: null,
      toAt: null,
      configurationKey: null,
      cohort: 'core',
    }),
  );
}

async function notFoundAs(text: string, read: () => Promise<ViewRead>): Promise<ViewRead> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { kind: 'invalid', text };
    throw error;
  }
}

export async function readView(
  db: Database,
  scope: Scope,
  view: AgentView,
  now = new Date(),
): Promise<ViewRead> {
  switch (view.kind) {
    case 'visibility_trend':
    case 'visibility_ranking':
    case 'visibility_sources':
      return visibilityRead(db, scope, view, now);
    case 'site_health_summary':
      return notFoundAs(
        'crawl_id is not a crawl of this project. Omit it for the latest crawl.',
        async () => {
          const read = await dashboard(db, scope.workspaceId, scope.projectId, view.crawl_id);
          return read.crawl ? AVAILABLE : { kind: 'unavailable', reason: 'no_site_crawl' };
        },
      );
    case 'ai_traffic_overview': {
      const read = await aiTrafficOverview(db, scope, { range: view.range });
      const connected = read.crawl.connection !== 'not_connected';
      return connected || read.referrals.window_end !== null
        ? AVAILABLE
        : { kind: 'unavailable', reason: 'no_ai_traffic' };
    }
    case 'keyword_research_rows':
      return notFoundAs(
        'dataset_id is not a published Keyword research dataset of this project. Use an id a read returned.',
        async () => {
          await datasetPage(
            db,
            { workspace: new WorkspaceScope(scope.workspaceId), projectId: scope.projectId },
            view.dataset_id,
            {
              cursor: null,
              limit: 1,
              sort: 'id',
              direction: 'asc',
              search: '',
              minVolume: null,
              intent: '',
            },
          );
          return AVAILABLE;
        },
      );
    default: {
      const exhaustive: never = view;
      return exhaustive;
    }
  }
}
