import { policy } from '../config.ts';
import { ApiError, notFound } from '../errors.ts';
import type { ParamSpecs } from '../http/params.ts';
import { InvalidCursorError } from '../http/keyset-cursor.ts';
import {
  AnalysisNotFoundError,
  TrendQueryError,
  type RunSelection,
} from '../visibility/selection.ts';

export const PROJECT_PATH = {
  project_id: { scalar: { kind: 'uuid' }, required: true, description: 'The project ID.' },
} as const;
const COHORT_TEXT =
  'Which prompts to count: `core` (unbranded), `comparison` (the brand against competitors) or `all` (the answers of both, counted as one set).';
export const COHORT = {
  scalar: { kind: 'literal', values: ['core', 'comparison', 'all'] },
  default: 'core',
  description: COHORT_TEXT,
} as const;
export const cohortFilter = (omitted: string) =>
  ({ scalar: COHORT.scalar, description: `${COHORT_TEXT} ${omitted}` }) as const;
export const ENGINE = {
  scalar: { kind: 'str' },
  description: 'Only answers from this logical engine, such as `chatgpt`. Omitted: every engine.',
} as const;
export const MARKET = {
  market: {
    scalar: { kind: 'uuid' },
    description:
      "The measurement market's ID. Omitted: the project's default market. A named run implies its own market.",
  },
} as const satisfies ParamSpecs;
export const RUNS = {
  audit_id: {
    scalar: { kind: 'uuid' },
    description: 'One measurement run (audit) to read. It must belong to the project.',
  },
  audit_ids: {
    scalar: { kind: 'uuid' },
    list: true,
    description:
      'Several runs read together; repeat the parameter. Each must belong to the project and have finished measuring.',
  },
  ...MARKET,
} as const satisfies ParamSpecs;
export const WINDOW = {
  from_at: {
    scalar: { kind: 'datetime' },
    alias: 'from',
    description: 'Only runs completed at or after this time (ISO 8601).',
  },
  to_at: {
    scalar: { kind: 'datetime' },
    alias: 'to',
    description: 'Only runs completed at or before this time (ISO 8601).',
  },
} as const satisfies ParamSpecs;
export const TOPIC = {
  topic: {
    scalar: { kind: 'uuid' },
    description:
      "Only answers to prompts filed under this topic when their run froze them. Moving a prompt later doesn't change past runs.",
  },
} as const satisfies ParamSpecs;
export const LIMIT = {
  scalar: { kind: 'int', ge: 1, le: policy.visibility.evidence_max_limit },
  default: policy.visibility.evidence_default_limit,
  description: 'The most rows to return on this page.',
} as const;
export const CURSOR = {
  scalar: { kind: 'str', maxLength: 2048 },
  description: "The previous page's `next_cursor`. Omitted: the first page.",
} as const;
export const BASELINE_ID = {
  scalar: { kind: 'uuid' },
  description:
    'An earlier run to compare against. Omitted: the previous run with the same measurement context.',
} as const;
export const BASELINE_RUNS = {
  scalar: { kind: 'uuid' },
  list: true,
  description:
    'Runs to compare the selection against; repeat the parameter. Omitted: no comparison, or the previous comparable run where the read picks one.',
} as const;
export const MAX_URL_LENGTH = 8192;
export const EVIDENCE_FILTERS = {
  outcome: {
    scalar: { kind: 'literal', values: ['brand_absent', 'uncited', 'competitor_gap'] },
    description:
      '`brand_absent`: answers that did not name the brand. `uncited`: named it without citing its site. `competitor_gap`: named `competitor` but not the brand (needs `competitor`).',
  },
  competitor: {
    scalar: { kind: 'str', maxLength: 255 },
    description: 'Only answers that named this tracked competitor, by its name.',
  },
  domain: {
    scalar: { kind: 'str', maxLength: 255 },
    description: 'Only answers that cited this domain.',
  },
  url: {
    scalar: { kind: 'str', maxLength: MAX_URL_LENGTH },
    description: 'Only answers that cited this exact URL.',
  },
  prompt_id: { scalar: { kind: 'uuid' }, description: 'Only answers to this prompt.' },
} as const satisfies ParamSpecs;

export const family = { family: 'visibility', authorize: 'active-project' } as const;

const UNMEASURED_CODES = {
  not_measured: 'visibility_not_measured',
  metrics_pending: 'visibility_metrics_pending',
} as const;

export async function selectionErrors<T>(
  read: () => Promise<T>,
  missing: () => ApiError = () => notFound('Audit'),
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof AnalysisNotFoundError) {
      if (error.reason === 'not_found') throw missing();
      throw new ApiError(404, error.message, { code: UNMEASURED_CODES[error.reason] });
    }
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
  topic?: string | null;
};

export const marketScope = (
  workspaceId: string,
  projectId: string,
  query: { market: string | null; topic?: string | null },
) => ({ workspaceId, projectId, marketId: query.market, topicId: query.topic ?? null });

export function runSelection(
  workspaceId: string,
  projectId: string,
  query: SelectionQuery,
): RunSelection {
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
    topicId: query.topic ?? null,
  };
}

export const PERCEPTION_SELECTION = {
  ...RUNS,
  engine: ENGINE,
  cohort: COHORT,
  ...WINDOW,
} as const satisfies ParamSpecs;
