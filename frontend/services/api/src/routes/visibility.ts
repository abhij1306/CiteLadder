import { surfaceRatesSchema } from '@citeladder/contracts/audits';
import {
  accuracyClaimPageSchema,
  accuracyFactListSchema,
  accuracyResponseSchema,
  claimVerdictSchema,
} from '@citeladder/contracts/fact-checking';
import {
  promptHistorySchema,
  promptMetricItemSchema,
  visibilityMarketsSchema,
  visibilitySchema,
} from '@citeladder/contracts/visibility';
import { visibilityFanoutSummarySchema } from '@citeladder/contracts/visibility-evidence';
import {
  perceptionQuotePageSchema,
  perceptionResponseSchema,
} from '@citeladder/contracts/visibility-perception';
import { visibilityMatrixSchema } from '@citeladder/contracts/visibility-matrix';
import { visibilityTopicsSchema } from '@citeladder/contracts/visibility-topics';
import { visibilityTrendListSchema } from '@citeladder/contracts/visibility-trends';
import { visibilityAdsResponseSchema } from '@citeladder/contracts/visibility-ads';
import { z } from 'zod';

import { policy } from '../config.ts';
import { csvDownload } from '../http/table-export.ts';
import {
  accuracyClaimRows,
  CLAIM_EXPORT_COLUMNS,
  getAccuracy,
  getAccuracyClaims,
  getAccuracyFacts,
} from '../visibility/accuracy.ts';
import { getAds } from '../visibility/ads.ts';
import { getRankedVisibility } from '../visibility/ranking-sentiment.ts';
import { getVisibilityFanout } from '../visibility/fanout.ts';
import { getMarketVisibility } from '../visibility/markets.ts';
import { getPerception, getPerceptionQuotes } from '../visibility/perception.ts';
import { getPromptHistory } from '../visibility/prompt-history.ts';
import { getLatestPromptMetrics } from '../visibility/prompt-latest.ts';
import { getPromptMetrics } from '../visibility/prompts.ts';
import { surfaceRates } from '../visibility/surface.ts';
import { getVisibilityMatrix } from '../visibility/matrix.ts';
import { getVisibilityTopics } from '../visibility/topics.ts';
import { getVisibilityTrends } from '../visibility/trends.ts';
import { defineGetRoute } from './define.ts';
import { competitorFocusRoute } from './visibility-competitor.ts';
import {
  BASELINE_ID,
  BASELINE_RUNS,
  COHORT,
  cohortFilter,
  CURSOR,
  ENGINE,
  EVIDENCE_FILTERS,
  family,
  LIMIT,
  MARKET,
  marketScope,
  PERCEPTION_SELECTION,
  PROJECT_PATH,
  RUNS,
  runSelection,
  selectionErrors,
  TOPIC,
  WINDOW,
} from './visibility-selection.ts';
import { visibilitySourceRoutes } from './visibility-sources.ts';

const DASHBOARD_SELECTION = {
  audit_id: RUNS.audit_id,
  ...MARKET,
  ...TOPIC,
  engine: ENGINE,
  selection_mode: {
    scalar: { kind: 'literal', values: ['latest', 'run', 'range'] },
    default: 'latest',
    description:
      "`latest`: the market's newest finished run. `run`: the run named by `audit_id`. `range`: the runs of one configuration between `from` and `to`.",
  },
  ...WINDOW,
  configuration_key: {
    scalar: { kind: 'str' },
    description:
      'With `range`: which measurement configuration to read when the period mixes several. Omitted: the one measured most recently, preferring whole prompt sets.',
  },
  cohort: COHORT,
} as const;

type DashboardParams = {
  audit_id: string | null;
  engine: string | null;
  selection_mode: 'latest' | 'run' | 'range';
  from_at: Parameters<typeof getRankedVisibility>[2]['fromAt'];
  to_at: Parameters<typeof getRankedVisibility>[2]['toAt'];
  configuration_key: string | null;
  cohort: string;
};

const dashboardQuery = (query: DashboardParams) => ({
  auditId: query.audit_id,
  logicalEngine: query.engine,
  selectionMode: query.selection_mode,
  fromAt: query.from_at,
  toAt: query.to_at,
  configurationKey: query.configuration_key,
  cohort: query.cohort,
});

const GRANULARITY_NAMES = policy.visibility.trend_granularities
  .map((value) => `\`${value}\``)
  .join(', ');

const CLAIM_FILTERS = {
  ...PERCEPTION_SELECTION,
  topic: { scalar: { kind: 'literal', values: policy.perception.fact_check.topics } },
  verdict: { scalar: { kind: 'literal', values: claimVerdictSchema.options } },
} as const;

const claimSelection = (
  workspaceId: string,
  projectId: string,
  query: Parameters<typeof runSelection>[2],
) => runSelection(workspaceId, projectId, { ...query, topic: null });

export const visibilityRoutes = [
  defineGetRoute({
    ...family,
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility/ads',
    params: {
      path: PROJECT_PATH,
      query: {
        ...PERCEPTION_SELECTION,
        ...TOPIC,
        cursor: CURSOR,
        limit: {
          scalar: { kind: 'int', ge: 1, le: policy.visibility.ads_creatives_max_limit },
          default: policy.visibility.ads_creatives_default_limit,
        },
      },
    },
    response: visibilityAdsResponseSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return selectionErrors(() =>
        getAds(db, runSelection(workspace.workspaceId, path.project_id, query), {
          cursor: query.cursor,
          limit: query.limit,
        }),
      );
    },
  }),
  defineGetRoute({
    ...family,
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility/perception',
    params: { path: PROJECT_PATH, query: PERCEPTION_SELECTION },
    response: perceptionResponseSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return selectionErrors(() =>
        getPerception(db, runSelection(workspace.workspaceId, path.project_id, query)),
      );
    },
  }),
  defineGetRoute({
    ...family,
    path: '/api/v1/projects/{project_id}/visibility/perception/quotes',
    params: {
      path: PROJECT_PATH,
      query: {
        ...PERCEPTION_SELECTION,
        entity: { scalar: { kind: 'str', maxLength: 255 } },
        theme: {
          scalar: { kind: 'str', maxLength: policy.perception.project_themes.name_max_chars },
        },
        polarity: { scalar: { kind: 'literal', values: ['positive', 'negative'] } },
        cursor: CURSOR,
        limit: {
          scalar: { kind: 'int', ge: 1, le: policy.perception.quotes_max_limit },
          default: policy.perception.quotes_default_limit,
        },
      },
    },
    response: perceptionQuotePageSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return selectionErrors(() =>
        getPerceptionQuotes(db, runSelection(workspace.workspaceId, path.project_id, query), {
          entity: query.entity,
          theme: query.theme,
          polarity: query.polarity,
          cursor: query.cursor,
          limit: query.limit,
        }),
      );
    },
  }),
  defineGetRoute({
    ...family,
    path: '/api/v1/projects/{project_id}/visibility/accuracy',
    params: { path: PROJECT_PATH, query: PERCEPTION_SELECTION },
    response: accuracyResponseSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return selectionErrors(() =>
        getAccuracy(db, runSelection(workspace.workspaceId, path.project_id, query)),
      );
    },
  }),
  defineGetRoute({
    ...family,
    path: '/api/v1/projects/{project_id}/visibility/accuracy/claims',
    params: {
      path: PROJECT_PATH,
      query: {
        ...CLAIM_FILTERS,
        cursor: CURSOR,
        limit: {
          scalar: { kind: 'int', ge: 1, le: policy.perception.fact_check.claims_max_limit },
          default: policy.perception.fact_check.claims_default_limit,
        },
      },
    },
    response: accuracyClaimPageSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return selectionErrors(() =>
        getAccuracyClaims(db, claimSelection(workspace.workspaceId, path.project_id, query), {
          topic: query.topic,
          verdict: query.verdict,
          cursor: query.cursor,
          limit: query.limit,
        }),
      );
    },
  }),
  defineGetRoute({
    ...family,
    path: '/api/v1/projects/{project_id}/visibility/accuracy/claims/export',
    params: { path: PROJECT_PATH, query: CLAIM_FILTERS },
    raw: true,
    response: z.string().meta({ format: 'binary' }),
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      const rows = await selectionErrors(() =>
        accuracyClaimRows(db, claimSelection(workspace.workspaceId, path.project_id, query), {
          topic: query.topic,
          verdict: query.verdict,
        }),
      );
      return csvDownload('fact-check-claims.csv', CLAIM_EXPORT_COLUMNS, [rows]);
    },
  }),
  defineGetRoute({
    ...family,
    path: '/api/v1/projects/{project_id}/visibility/accuracy/facts',
    params: { path: PROJECT_PATH, query: PERCEPTION_SELECTION },
    response: accuracyFactListSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return selectionErrors(() =>
        getAccuracyFacts(db, runSelection(workspace.workspaceId, path.project_id, query)),
      );
    },
  }),
  defineGetRoute({
    ...family,
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility',
    params: {
      path: PROJECT_PATH,
      query: { ...DASHBOARD_SELECTION, baseline_id: BASELINE_ID },
    },
    response: visibilitySchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return selectionErrors(() =>
        getRankedVisibility(db, marketScope(workspace.workspaceId, path.project_id, query), {
          ...dashboardQuery(query),
          baselineId: query.baseline_id,
        }),
      );
    },
  }),
  defineGetRoute({
    ...family,
    path: '/api/v1/projects/{project_id}/visibility/topics',
    params: { path: PROJECT_PATH, query: DASHBOARD_SELECTION },
    response: visibilityTopicsSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return selectionErrors(() =>
        getVisibilityTopics(
          db,
          marketScope(workspace.workspaceId, path.project_id, query),
          dashboardQuery(query),
        ),
      );
    },
  }),
  defineGetRoute({
    ...family,
    path: '/api/v1/projects/{project_id}/visibility/matrix',
    params: { path: PROJECT_PATH, query: DASHBOARD_SELECTION },
    response: visibilityMatrixSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return selectionErrors(() =>
        getVisibilityMatrix(
          db,
          marketScope(workspace.workspaceId, path.project_id, query),
          dashboardQuery(query),
        ),
      );
    },
  }),
  defineGetRoute({
    ...family,
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility/prompts',
    params: {
      path: PROJECT_PATH,
      query: {
        ...RUNS,
        baseline_audit_ids: BASELINE_RUNS,
        engine: ENGINE,
        baseline_id: BASELINE_ID,
        cohort: cohortFilter('Omitted: `core`. `latest=prompt` takes no cohort.'),
        latest: {
          scalar: { kind: 'literal', values: ['run', 'prompt'] },
          default: 'run',
          description:
            "`run`: every prompt of the selected run. `prompt`: each tracked prompt's own latest run, taking no other selection.",
        },
      },
    },
    response: z.array(promptMetricItemSchema),
    async handle({ c, db }, { path, query }) {
      const scope = marketScope(c.get('workspace').workspaceId, path.project_id, query);
      const runs = {
        auditId: query.audit_id,
        auditIds: query.audit_ids,
        baselineAuditIds: query.baseline_audit_ids,
        baselineId: query.baseline_id,
      };
      return selectionErrors(() =>
        query.latest === 'prompt'
          ? getLatestPromptMetrics(db, scope, {
              narrowed: [query.engine, query.cohort, ...Object.values(runs)].some(
                (value) => value != null,
              ),
            })
          : getPromptMetrics(db, scope, {
              ...runs,
              logicalEngine: query.engine,
              cohort: query.cohort ?? 'core',
            }),
      );
    },
  }),
  defineGetRoute({
    ...family,
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility/prompts/{prompt_id}/history',
    params: {
      path: { ...PROJECT_PATH, prompt_id: { scalar: { kind: 'uuid' }, required: true } },
      query: { ...MARKET, engine: ENGINE, cohort: cohortFilter("Omitted: the prompt's own.") },
    },
    response: promptHistorySchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return selectionErrors(() =>
        getPromptHistory(db, marketScope(workspace.workspaceId, path.project_id, query), {
          promptId: path.prompt_id,
          logicalEngine: query.engine,
          cohort: query.cohort,
        }),
      );
    },
  }),
  defineGetRoute({
    ...family,
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility/trends',
    params: {
      path: PROJECT_PATH,
      query: {
        ...MARKET,
        ...TOPIC,
        engine: ENGINE,
        ...WINDOW,
        granularity: {
          scalar: { kind: 'str' },
          default: policy.visibility.trend_default_granularity,
          description: `The length of each series point: ${GRANULARITY_NAMES}. \`run\` plots one point per run.`,
        },
        transport_model: {
          scalar: { kind: 'str' },
          description: 'Only runs answered by this exact provider model.',
        },
        retrieval_enabled: {
          scalar: { kind: 'bool' },
          description: 'Only runs with web retrieval on (`true`) or off (`false`).',
        },
        cohort: COHORT,
      },
    },
    response: visibilityTrendListSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return selectionErrors(() =>
        getVisibilityTrends(db, marketScope(workspace.workspaceId, path.project_id, query), {
          logicalEngine: query.engine,
          fromAt: query.from_at,
          toAt: query.to_at,
          granularity: query.granularity,
          transportModel: query.transport_model,
          retrievalEnabled: query.retrieval_enabled,
          cohort: query.cohort,
        }),
      );
    },
  }),
  defineGetRoute({
    ...family,
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility/fanout',
    params: {
      path: PROJECT_PATH,
      query: {
        ...RUNS,
        ...TOPIC,
        engine: ENGINE,
        cohort: COHORT,
        ...EVIDENCE_FILTERS,
        query: {
          scalar: { kind: 'str', maxLength: 8192 },
          description: 'One fanout query, exactly: pages the answers that searched it instead.',
        },
        search: {
          scalar: { kind: 'str', maxLength: 512 },
          description: 'Only queries containing this text, ignoring case.',
        },
        order: {
          scalar: { kind: 'literal', values: ['top', 'rising', 'falling'] },
          default: 'top',
          description:
            '`top`: most answers first, paged. `rising` and `falling`: one page by share change against the previous comparable run.',
        },
        cursor: CURSOR,
        limit: LIMIT,
      },
    },
    response: visibilityFanoutSummarySchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return selectionErrors(() =>
        getVisibilityFanout(
          db,
          runSelection(workspace.workspaceId, path.project_id, {
            ...query,
            from_at: null,
            to_at: null,
          }),
          {
            query: query.query,
            search: query.search,
            order: query.order,
            cursor: query.cursor,
            limit: query.limit,
            filters: {
              outcome: query.outcome,
              competitor: query.competitor,
              domain: query.domain,
              url: query.url,
              promptId: query.prompt_id,
            },
          },
        ),
      );
    },
  }),
  ...visibilitySourceRoutes,
  defineGetRoute({
    ...family,
    path: '/api/v1/projects/{project_id}/visibility/surface-rates',
    params: {
      path: PROJECT_PATH,
      query: {
        engine: { scalar: { kind: 'str' }, required: true },
        ...RUNS,
        cohort: COHORT,
      },
    },
    response: surfaceRatesSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return selectionErrors(() =>
        surfaceRates(db, {
          workspaceId: workspace.workspaceId,
          projectId: path.project_id,
          marketId: query.market,
          logicalEngine: query.engine,
          auditId: query.audit_id,
          auditIds: query.audit_ids,
          cohort: query.cohort,
        }),
      );
    },
  }),
  defineGetRoute({
    ...family,
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility/markets',
    params: { path: PROJECT_PATH, query: { cohort: COHORT, ...TOPIC } },
    response: visibilityMarketsSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return selectionErrors(() =>
        getMarketVisibility(
          db,
          { workspaceId: workspace.workspaceId, projectId: path.project_id, topicId: query.topic },
          query.cohort,
        ),
      );
    },
  }),
  competitorFocusRoute,
];
