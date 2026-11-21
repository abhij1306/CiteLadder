import {
  visibilityEvidenceResponseSchema,
  visibilitySourceMoversSchema,
  visibilitySourceNearMissesSchema,
  visibilitySourceSeriesSchema,
  visibilitySourcesSchema,
  visibilitySourceUrlSchema,
} from '@citeladder/contracts/visibility-evidence';

import { policy } from '../config.ts';
import { getVisibilityEvidence } from '../visibility/evidence.ts';
import { getSourceMovers } from '../visibility/source-movers.ts';
import { getSourceNearMisses } from '../visibility/source-retrieval.ts';
import { getSourceSeries, SOURCE_SERIES_MAX_SERIES } from '../visibility/source-series.ts';
import { getSourceUrlDetail } from '../visibility/source-url.ts';
import { getVisibilitySources } from '../visibility/sources.ts';
import { defineGetRoute } from './define.ts';
import {
  BASELINE_RUNS,
  COHORT,
  CURSOR,
  ENGINE,
  EVIDENCE_FILTERS,
  family,
  LIMIT,
  MAX_URL_LENGTH,
  PROJECT_PATH,
  RUNS,
  runSelection,
  selectionErrors,
  TOPIC,
  WINDOW,
} from './visibility-selection.ts';

const DIMENSION = {
  scalar: { kind: 'literal', values: ['domain', 'url'] },
  default: 'domain',
  description: 'Rows per publisher domain, or per cited page URL.',
} as const;
const AS_OF = {
  scalar: { kind: 'datetime' },
  description:
    'Read runs finished by this time, with a timezone, so paging is stable. Omitted: now; later pages carry it in the cursor.',
} as const;

export const visibilitySourceRoutes = [
  defineGetRoute({
    ...family,
    exposure: 'both',
    path: '/api/v1/projects/{project_id}/visibility/sources',
    params: {
      path: PROJECT_PATH,
      query: {
        ...RUNS,
        ...TOPIC,
        baseline_audit_ids: BASELINE_RUNS,
        engine: ENGINE,
        cohort: COHORT,
        domain: {
          scalar: { kind: 'str', maxLength: 255 },
          description: 'One publisher domain: its pages, as with `dimension=url`.',
        },
        source_type: { scalar: { kind: 'str', maxLength: 64 } },
        standing: {
          scalar: { kind: 'literal', values: ['gap'] },
          description:
            '`gap`: only pages that list a tracked competitor and not the business. Page rows only (`dimension=url` or a `domain`).',
        },
        dimension: DIMENSION,
        ...WINDOW,
        as_of: AS_OF,
        cursor: CURSOR,
        limit: LIMIT,
      },
    },
    response: visibilitySourcesSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
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
    ...family,
    exposure: 'both',
    publicPath: '/v1/projects/{project_id}/visibility/answers',
    path: '/api/v1/projects/{project_id}/visibility/evidence',
    params: {
      path: PROJECT_PATH,
      query: {
        ...RUNS,
        ...TOPIC,
        cursor: CURSOR,
        as_of: AS_OF,
        ...EVIDENCE_FILTERS,
        engine: ENGINE,
        ...WINDOW,
        limit: LIMIT,
        cohort: COHORT,
      },
    },
    response: visibilityEvidenceResponseSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
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
    ...family,
    path: '/api/v1/projects/{project_id}/visibility/sources/series',
    params: {
      path: PROJECT_PATH,
      query: {
        dimension: DIMENSION,
        granularity: {
          scalar: { kind: 'literal', values: ['day', 'week', 'month'] },
          default: 'day',
          description: 'The length of each series point.',
        },
        ...RUNS,
        ...TOPIC,
        engine: ENGINE,
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
    ...family,
    path: '/api/v1/projects/{project_id}/visibility/sources/near-misses',
    params: {
      path: PROJECT_PATH,
      query: {
        ...RUNS,
        ...TOPIC,
        engine: ENGINE,
        cohort: COHORT,
        ...WINDOW,
        limit: LIMIT,
      },
    },
    response: visibilitySourceNearMissesSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return selectionErrors(() =>
        getSourceNearMisses(db, runSelection(workspace.workspaceId, path.project_id, query), {
          asOf: new Date().toISOString(),
          limit: query.limit,
        }),
      );
    },
  }),
  defineGetRoute({
    ...family,
    path: '/api/v1/projects/{project_id}/visibility/sources/movers',
    params: {
      path: PROJECT_PATH,
      query: {
        ...RUNS,
        ...TOPIC,
        baseline_audit_ids: BASELINE_RUNS,
        engine: ENGINE,
        cohort: COHORT,
        dimension: DIMENSION,
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
    ...family,
    path: '/api/v1/projects/{project_id}/visibility/sources/url',
    params: {
      path: PROJECT_PATH,
      query: {
        url: { scalar: { kind: 'str', minLength: 1, maxLength: MAX_URL_LENGTH }, required: true },
        ...RUNS,
        ...TOPIC,
        engine: ENGINE,
        cohort: COHORT,
        ...WINDOW,
      },
    },
    response: visibilitySourceUrlSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      return selectionErrors(() =>
        getSourceUrlDetail(
          db,
          runSelection(workspace.workspaceId, path.project_id, query),
          query.url,
        ),
      );
    },
  }),
];
