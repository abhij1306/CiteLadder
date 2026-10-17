/**
 * `visibility`: every persisted visibility read for one measurement
 * selection: the dashboard, prompt scores and one prompt's history, trends,
 * query fanout, Sources (table, series and one URL), per-answer evidence, answer perception
 * (summary and quotes), fact-check accuracy (summary and claims), ads in AI
 * answers and the observed AI Overview rates.
 *
 * Reads of persisted projections; nothing is
 * fetched. An unknown or out-of-scope run is `Audit not found`, and a
 * malformed selection is a 422 carrying the reader's message.
 */
import { surfaceRatesSchema } from '@citeladder/contracts/audits';
import {
  accuracyClaimPageSchema,
  accuracyResponseSchema,
  claimVerdictSchema,
} from '@citeladder/contracts/fact-checking';
import {
  promptHistorySchema,
  promptMetricItemSchema,
  visibilityMarketsSchema,
  visibilitySchema,
} from '@citeladder/contracts/visibility';
import {
  visibilityEvidenceResponseSchema,
  visibilityFanoutSummarySchema,
  visibilitySourceMoversSchema,
  visibilitySourceNearMissesSchema,
  visibilitySourceSeriesSchema,
  visibilitySourcesSchema,
  visibilitySourceUrlSchema,
} from '@citeladder/contracts/visibility-evidence';
import {
  perceptionQuotePageSchema,
  perceptionResponseSchema,
} from '@citeladder/contracts/visibility-perception';
import { visibilityTrendListSchema } from '@citeladder/contracts/visibility-trends';
import { visibilityAdsResponseSchema } from '@citeladder/contracts/visibility-ads';
import { z } from 'zod';

import { policy } from '../config.ts';
import { ApiError, notFound } from '../errors.ts';
import type { ParamSpecs } from '../http/params.ts';
import { InvalidCursorError } from '../http/keyset-cursor.ts';
import { requireProject } from '../projects/access.ts';
import { getAccuracy, getAccuracyClaims } from '../visibility/accuracy.ts';
import { getAds } from '../visibility/ads.ts';
import { getVisibility } from '../visibility/dashboard.ts';
import { getVisibilityEvidence } from '../visibility/evidence.ts';
import { getVisibilityFanout } from '../visibility/fanout.ts';
import { getMarketVisibility } from '../visibility/markets.ts';
import { getPerception, getPerceptionQuotes } from '../visibility/perception.ts';
import { getPromptHistory } from '../visibility/prompt-history.ts';
import { getPromptMetrics } from '../visibility/prompts.ts';
import {
  AnalysisNotFoundError,
  TrendQueryError,
  type RunSelection,
} from '../visibility/selection.ts';
import { getSourceMovers } from '../visibility/source-movers.ts';
import { getSourceNearMisses } from '../visibility/source-retrieval.ts';
import { getSourceSeries, SOURCE_SERIES_MAX_SERIES } from '../visibility/source-series.ts';
import { getSourceUrlDetail } from '../visibility/source-url.ts';
import { getVisibilitySources } from '../visibility/sources.ts';
import { surfaceRates } from '../visibility/surface.ts';
import { getVisibilityTrends } from '../visibility/trends.ts';
import { defineGetRoute } from './define.ts';

const PROJECT_PATH = { project_id: { scalar: { kind: 'uuid' }, required: true } } as const;
const COHORT = {
  scalar: { kind: 'literal', values: ['core', 'comparison', 'all'] },
  default: 'core',
} as const;
/** The measurement market; omitted is the project default. Named runs imply their own. */
const MARKET = { market: { scalar: { kind: 'uuid' } } } as const satisfies ParamSpecs;
const RUNS = {
  audit_id: { scalar: { kind: 'uuid' } },
  audit_ids: { scalar: { kind: 'uuid' }, list: true },
  ...MARKET,
} as const satisfies ParamSpecs;
const WINDOW = {
  from_at: { scalar: { kind: 'datetime' }, alias: 'from' },
  to_at: { scalar: { kind: 'datetime' }, alias: 'to' },
} as const satisfies ParamSpecs;
const LIMIT = {
  scalar: { kind: 'int', ge: 1, le: policy.visibility.evidence_max_limit },
  default: policy.visibility.evidence_default_limit,
} as const;
const BASELINE_RUNS = { scalar: { kind: 'uuid' }, list: true } as const;
// `citations.url` is unbounded text, so this cap decides which pages have a
// detail view at all: the practical ceiling a query string survives.
const MAX_URL_LENGTH = 8192;

/**
 * Translate the readers' selection errors: an unservable selection is a 404
 * (`Audit not found` unless the route names what is missing) and a malformed
 * one a 422 carrying the reader's message.
 */
async function selectionErrors<T>(
  read: () => Promise<T>,
  missing: () => ApiError = () => notFound('Audit'),
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof AnalysisNotFoundError) throw missing();
    if (error instanceof TrendQueryError || error instanceof InvalidCursorError)
      throw new ApiError(422, error.message);
    throw error;
  }
}

type SelectionQuery = {
  market: string | null;
  audit_id: string | null;
  audit_ids: string[] | null;
  engine: string | null;
  cohort: string;
  from_at: RunSelection['fromAt'];
  to_at: RunSelection['toAt'];
};

/** A project's runs in the requested market (omitted: the default). */
const marketScope = (workspaceId: string, projectId: string, marketId: string | null) => ({
  workspaceId,
  projectId,
  marketId,
});

function runSelection(workspaceId: string, projectId: string, query: SelectionQuery): RunSelection {
  return {
    workspaceId,
    projectId,
    marketId: query.market,
    auditId: query.audit_id,
    auditIds: query.audit_ids,
    logicalEngine: query.engine,
    cohort: query.cohort,
    fromAt: query.from_at,
    toAt: query.to_at,
  };
}

const PERCEPTION_SELECTION = {
  ...RUNS,
  engine: { scalar: { kind: 'str' } },
  cohort: COHORT,
  ...WINDOW,
} as const satisfies ParamSpecs;

export const visibilityRoutes = [
  defineGetRoute({
    family: 'visibility',
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility/ads',
    params: {
      path: PROJECT_PATH,
      query: {
        ...PERCEPTION_SELECTION,
        cursor: { scalar: { kind: 'str', maxLength: 2048 } },
        limit: {
          scalar: { kind: 'int', ge: 1, le: policy.visibility.ads_creatives_max_limit },
          default: policy.visibility.ads_creatives_default_limit,
        },
      },
    },
    response: visibilityAdsResponseSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return selectionErrors(() =>
        getAds(db, runSelection(workspace.workspaceId, path.project_id, query), {
          cursor: query.cursor,
          limit: query.limit,
        }),
      );
    },
  }),
  defineGetRoute({
    family: 'visibility',
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility/perception',
    params: { path: PROJECT_PATH, query: PERCEPTION_SELECTION },
    response: perceptionResponseSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return selectionErrors(() =>
        getPerception(db, runSelection(workspace.workspaceId, path.project_id, query)),
      );
    },
  }),
  defineGetRoute({
    family: 'visibility',
    path: '/api/v1/projects/{project_id}/visibility/perception/quotes',
    params: {
      path: PROJECT_PATH,
      query: {
        ...PERCEPTION_SELECTION,
        entity: { scalar: { kind: 'str', maxLength: 255 } },
        theme: { scalar: { kind: 'literal', values: policy.perception.themes } },
        polarity: { scalar: { kind: 'literal', values: ['positive', 'negative'] } },
        cursor: { scalar: { kind: 'str', maxLength: 2048 } },
        limit: {
          scalar: { kind: 'int', ge: 1, le: policy.perception.quotes_max_limit },
          default: policy.perception.quotes_default_limit,
        },
      },
    },
    response: perceptionQuotePageSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
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
    family: 'visibility',
    path: '/api/v1/projects/{project_id}/visibility/accuracy',
    params: { path: PROJECT_PATH, query: PERCEPTION_SELECTION },
    response: accuracyResponseSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return selectionErrors(() =>
        getAccuracy(db, runSelection(workspace.workspaceId, path.project_id, query)),
      );
    },
  }),
  defineGetRoute({
    family: 'visibility',
    path: '/api/v1/projects/{project_id}/visibility/accuracy/claims',
    params: {
      path: PROJECT_PATH,
      query: {
        ...PERCEPTION_SELECTION,
        topic: { scalar: { kind: 'literal', values: policy.perception.fact_check.topics } },
        verdict: { scalar: { kind: 'literal', values: claimVerdictSchema.options } },
        cursor: { scalar: { kind: 'str', maxLength: 2048 } },
        limit: {
          scalar: { kind: 'int', ge: 1, le: policy.perception.fact_check.claims_max_limit },
          default: policy.perception.fact_check.claims_default_limit,
        },
      },
    },
    response: accuracyClaimPageSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return selectionErrors(() =>
        getAccuracyClaims(db, runSelection(workspace.workspaceId, path.project_id, query), {
          topic: query.topic,
          verdict: query.verdict,
          cursor: query.cursor,
          limit: query.limit,
        }),
      );
    },
  }),
  defineGetRoute({
    family: 'visibility',
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility',
    params: {
      path: PROJECT_PATH,
      query: {
        audit_id: { scalar: { kind: 'uuid' } },
        ...MARKET,
        engine: { scalar: { kind: 'str' } },
        baseline_id: { scalar: { kind: 'uuid' } },
        selection_mode: {
          scalar: { kind: 'literal', values: ['latest', 'run', 'range'] },
          default: 'latest',
        },
        ...WINDOW,
        configuration_key: { scalar: { kind: 'str' } },
        cohort: COHORT,
      },
    },
    response: visibilitySchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return selectionErrors(
        () =>
          getVisibility(db, marketScope(workspace.workspaceId, path.project_id, query.market), {
            auditId: query.audit_id,
            logicalEngine: query.engine,
            baselineId: query.baseline_id,
            selectionMode: query.selection_mode,
            fromAt: query.from_at,
            toAt: query.to_at,
            configurationKey: query.configuration_key,
            cohort: query.cohort,
          }),
        () => new ApiError(404, 'No visibility metrics available for the selected measurement'),
      );
    },
  }),
  defineGetRoute({
    family: 'visibility',
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility/prompts',
    params: {
      path: PROJECT_PATH,
      query: {
        ...RUNS,
        baseline_audit_ids: BASELINE_RUNS,
        engine: { scalar: { kind: 'str' } },
        baseline_id: { scalar: { kind: 'uuid' } },
        cohort: COHORT,
      },
    },
    response: z.array(promptMetricItemSchema),
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return selectionErrors(() =>
        getPromptMetrics(db, marketScope(workspace.workspaceId, path.project_id, query.market), {
          auditId: query.audit_id,
          auditIds: query.audit_ids,
          baselineAuditIds: query.baseline_audit_ids,
          logicalEngine: query.engine,
          baselineId: query.baseline_id,
          cohort: query.cohort,
        }),
      );
    },
  }),
  defineGetRoute({
    family: 'visibility',
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility/prompts/{prompt_id}/history',
    params: {
      path: { ...PROJECT_PATH, prompt_id: { scalar: { kind: 'uuid' }, required: true } },
      // No cohort reads the prompt's own.
      query: { ...MARKET, engine: { scalar: { kind: 'str' } }, cohort: { scalar: COHORT.scalar } },
    },
    response: promptHistorySchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return selectionErrors(() =>
        getPromptHistory(db, marketScope(workspace.workspaceId, path.project_id, query.market), {
          promptId: path.prompt_id,
          logicalEngine: query.engine,
          cohort: query.cohort,
        }),
      );
    },
  }),
  defineGetRoute({
    family: 'visibility',
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility/trends',
    params: {
      path: PROJECT_PATH,
      query: {
        ...MARKET,
        engine: { scalar: { kind: 'str' } },
        ...WINDOW,
        granularity: {
          scalar: { kind: 'str' },
          default: policy.visibility.trend_default_granularity,
        },
        transport_model: { scalar: { kind: 'str' } },
        retrieval_enabled: { scalar: { kind: 'bool' } },
        cohort: COHORT,
      },
    },
    response: visibilityTrendListSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return selectionErrors(() =>
        getVisibilityTrends(db, marketScope(workspace.workspaceId, path.project_id, query.market), {
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
    family: 'visibility',
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility/fanout',
    params: {
      path: PROJECT_PATH,
      query: {
        ...RUNS,
        engine: { scalar: { kind: 'str' } },
        cohort: COHORT,
        query: { scalar: { kind: 'str', maxLength: 8192 } },
        search: { scalar: { kind: 'str', maxLength: 512 } },
        cursor: { scalar: { kind: 'str', maxLength: 2048 } },
        limit: LIMIT,
      },
    },
    response: visibilityFanoutSummarySchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return selectionErrors(() =>
        getVisibilityFanout(
          db,
          runSelection(workspace.workspaceId, path.project_id, {
            ...query,
            from_at: null,
            to_at: null,
          }),
          { query: query.query, search: query.search, cursor: query.cursor, limit: query.limit },
        ),
      );
    },
  }),
  defineGetRoute({
    family: 'visibility',
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility/sources',
    params: {
      path: PROJECT_PATH,
      query: {
        ...RUNS,
        baseline_audit_ids: BASELINE_RUNS,
        engine: { scalar: { kind: 'str' } },
        cohort: COHORT,
        domain: { scalar: { kind: 'str', maxLength: 255 } },
        source_type: { scalar: { kind: 'str', maxLength: 64 } },
        standing: { scalar: { kind: 'literal', values: ['gap'] } },
        dimension: { scalar: { kind: 'literal', values: ['domain', 'url'] }, default: 'domain' },
        ...WINDOW,
        as_of: { scalar: { kind: 'datetime' } },
        cursor: { scalar: { kind: 'str', maxLength: 2048 } },
        limit: LIMIT,
      },
    },
    response: visibilitySourcesSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return selectionErrors(() =>
        getVisibilitySources(db, runSelection(workspace.workspaceId, path.project_id, query), {
          domain: query.domain,
          sourceClass: query.source_type,
          standing: query.standing,
          dimension: query.dimension,
          asOf: query.as_of,
          cursor: query.cursor,
          limit: query.limit,
          baselineAuditIds: query.baseline_audit_ids,
        }),
      );
    },
  }),
  defineGetRoute({
    family: 'visibility',
    path: '/api/v1/projects/{project_id}/visibility/evidence',
    params: {
      path: PROJECT_PATH,
      query: {
        ...RUNS,
        cursor: { scalar: { kind: 'str', maxLength: 2048 } },
        as_of: { scalar: { kind: 'datetime' } },
        outcome: {
          scalar: { kind: 'literal', values: ['brand_absent', 'uncited', 'competitor_gap'] },
        },
        competitor: { scalar: { kind: 'str', maxLength: 255 } },
        domain: { scalar: { kind: 'str', maxLength: 255 } },
        url: { scalar: { kind: 'str', maxLength: MAX_URL_LENGTH } },
        prompt_id: { scalar: { kind: 'uuid' } },
        engine: { scalar: { kind: 'str' } },
        ...WINDOW,
        limit: LIMIT,
        cohort: COHORT,
      },
    },
    response: visibilityEvidenceResponseSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return selectionErrors(() =>
        getVisibilityEvidence(db, runSelection(workspace.workspaceId, path.project_id, query), {
          cursor: query.cursor,
          asOf: query.as_of,
          outcome: query.outcome,
          competitor: query.competitor,
          domain: query.domain,
          url: query.url,
          promptId: query.prompt_id,
          limit: query.limit,
        }),
      );
    },
  }),
  defineGetRoute({
    family: 'visibility',
    path: '/api/v1/projects/{project_id}/visibility/sources/series',
    params: {
      path: PROJECT_PATH,
      query: {
        dimension: { scalar: { kind: 'literal', values: ['domain', 'url'] }, default: 'domain' },
        granularity: {
          scalar: { kind: 'literal', values: ['day', 'week', 'month'] },
          default: 'day',
        },
        ...RUNS,
        engine: { scalar: { kind: 'str' } },
        cohort: COHORT,
        domain: { scalar: { kind: 'str', maxLength: 255 } },
        url: { scalar: { kind: 'str', minLength: 1, maxLength: MAX_URL_LENGTH } },
        source_type: { scalar: { kind: 'str', maxLength: 64 } },
        ...WINDOW,
        limit: {
          scalar: { kind: 'int', ge: 1, le: SOURCE_SERIES_MAX_SERIES },
          default: SOURCE_SERIES_MAX_SERIES,
        },
      },
    },
    response: visibilitySourceSeriesSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return selectionErrors(() =>
        getSourceSeries(db, runSelection(workspace.workspaceId, path.project_id, query), {
          dimension: query.dimension,
          granularity: query.granularity,
          domain: query.domain,
          url: query.url,
          sourceClass: query.source_type,
          limit: query.limit,
        }),
      );
    },
  }),
  defineGetRoute({
    family: 'visibility',
    path: '/api/v1/projects/{project_id}/visibility/sources/near-misses',
    params: {
      path: PROJECT_PATH,
      query: {
        ...RUNS,
        engine: { scalar: { kind: 'str' } },
        cohort: COHORT,
        ...WINDOW,
        limit: LIMIT,
      },
    },
    response: visibilitySourceNearMissesSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return selectionErrors(() =>
        getSourceNearMisses(db, runSelection(workspace.workspaceId, path.project_id, query), {
          asOf: new Date().toISOString(),
          limit: query.limit,
        }),
      );
    },
  }),
  defineGetRoute({
    family: 'visibility',
    path: '/api/v1/projects/{project_id}/visibility/sources/movers',
    params: {
      path: PROJECT_PATH,
      query: {
        ...RUNS,
        baseline_audit_ids: BASELINE_RUNS,
        engine: { scalar: { kind: 'str' } },
        cohort: COHORT,
        dimension: { scalar: { kind: 'literal', values: ['domain', 'url'] }, default: 'domain' },
        ...WINDOW,
        limit: {
          scalar: { kind: 'int', ge: 1, le: policy.visibility.source_movers_max_limit },
          default: policy.visibility.source_movers_default_limit,
        },
      },
    },
    response: visibilitySourceMoversSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return selectionErrors(() =>
        getSourceMovers(db, runSelection(workspace.workspaceId, path.project_id, query), {
          dimension: query.dimension,
          baselineAuditIds: query.baseline_audit_ids ?? [],
          limit: query.limit,
        }),
      );
    },
  }),
  defineGetRoute({
    family: 'visibility',
    path: '/api/v1/projects/{project_id}/visibility/sources/url',
    params: {
      path: PROJECT_PATH,
      query: {
        url: { scalar: { kind: 'str', minLength: 1, maxLength: MAX_URL_LENGTH }, required: true },
        ...RUNS,
        engine: { scalar: { kind: 'str' } },
        cohort: COHORT,
        ...WINDOW,
      },
    },
    response: visibilitySourceUrlSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return selectionErrors(() =>
        getSourceUrlDetail(
          db,
          runSelection(workspace.workspaceId, path.project_id, query),
          query.url,
        ),
      );
    },
  }),
  defineGetRoute({
    family: 'visibility',
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
      await requireProject(db, workspace, path.project_id);
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
    family: 'visibility',
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility/markets',
    params: { path: PROJECT_PATH, query: { cohort: COHORT } },
    response: visibilityMarketsSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return selectionErrors(() =>
        getMarketVisibility(
          db,
          { workspaceId: workspace.workspaceId, projectId: path.project_id },
          query.cohort,
        ),
      );
    },
  }),
];
