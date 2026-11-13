/**
 * The rows one Search Intelligence acquisition writes, built from the run and
 * its plan. Pure: AcquisitionState performs every insert and update.
 */
import { randomUUID } from 'node:crypto';
import type { Selectable } from 'kysely';
import { SEARCH_DATASET_KINDS } from '@citeladder/contracts/search-intelligence';
import type { SearchIntelligenceDatasets, SearchIntelligenceRuns } from '../generated/db-schema.ts';
import { record, strings } from '../db/json.ts';
import type { ProviderError } from '../providers/errors.ts';
import { scalarText } from '../text-order.ts';
import type { ResearchPlan } from './acquisition-state.ts';
import { INT4_MAX, type normalizeResponse } from './normalization.ts';
import { datasetKind, isBacklinkKind, si, type DatasetKind } from './requests.ts';

type Run = Selectable<SearchIntelligenceRuns>;
type Dataset = Selectable<SearchIntelligenceDatasets>;

/** Whether a dataset holds everything asked for, some of it, nothing, or is unknowable. */
function datasetCoverage(o: {
  resultAvailable: boolean;
  received: number;
  kind: DatasetKind;
  exhausted: boolean;
  saved: number;
  requested: number;
}) {
  if (!o.resultAvailable) return 'unknown';
  if (o.received === 0) return 'empty';
  const whole = SEARCH_DATASET_KINDS[o.kind].fixedDepth || o.exhausted || o.saved >= o.requested;
  return whole ? 'complete' : 'partial';
}
/** Whether the provider holds more rows than were saved for a list dataset. */
function isTruncated(coverage: string, kind: DatasetKind, total: number | null, saved: number) {
  if (coverage === 'partial') return true;
  return !SEARCH_DATASET_KINDS[kind].summary && total !== null && total > saved;
}

/** One dispatch attempt's row: its send, or the outcome of that send. */
export function newAttempt(
  call: { workspace_id: string; project_id: string; id: string },
  o: {
    ordinal: number;
    phase: 'dispatch' | 'outcome';
    status: string;
    error: ProviderError | null;
    dispatched: Date;
    at: Date | null;
  },
) {
  return {
    id: randomUUID(),
    workspace_id: call.workspace_id,
    project_id: call.project_id,
    call_id: call.id,
    ordinal: o.ordinal,
    phase: o.phase,
    status: o.status,
    error_code: o.error?.code ?? '',
    retry_after_seconds: o.error?.retryAfterSeconds ?? null,
    dispatched_at: o.dispatched,
    completed_at: o.at,
  };
}

/** One page's normalized rows, as the dataset's rows from this call. */
export function newRows(
  rows: ReturnType<typeof normalizeResponse>['rows'],
  dataset: Dataset,
  callId: string,
  at: Date,
) {
  return rows.map((row) => ({
    ...row,
    auxiliary: JSON.stringify(row.auxiliary),
    id: randomUUID(),
    workspace_id: dataset.workspace_id,
    project_id: dataset.project_id,
    dataset_id: dataset.id,
    call_id: callId,
    row_kind: dataset.dataset_kind,
    created_at: at,
  }));
}

/** A new call at intent for one page of the plan. */
export function newCall(o: {
  run: Run;
  datasetId: string;
  requestKey: string;
  sequence: number;
  plan: ResearchPlan;
  request: Record<string, unknown>;
  at: Date;
}) {
  const { run, plan, at } = o;
  return {
    id: randomUUID(),
    workspace_id: run.workspace_id,
    project_id: run.project_id,
    run_id: run.id,
    dataset_id: o.datasetId,
    request_key: o.requestKey,
    sequence: o.sequence,
    endpoint: String(plan.endpoint),
    sanitized_request: JSON.stringify(o.request),
    estimated_cost_usd: String(plan.estimated_cost_usd),
    status: 'intent',
    created_at: at,
    completed_at: null,
    dispatched_at: null,
    error_code: '',
    error_detail: '',
    provider_reported_cost_usd: null,
    provider_task_id: '',
    response_sha256: '',
    sanitized_response: null,
  };
}

/** A new collecting dataset for the plan's scope. */
export function newDataset(run: Run, plan: ResearchPlan, kind: DatasetKind, at: Date) {
  const target = record(plan.target),
    comparison = record(plan.comparison),
    request = record(plan.request);
  return {
    id: randomUUID(),
    workspace_id: run.workspace_id,
    project_id: run.project_id,
    run_id: run.id,
    dataset_kind: kind,
    scope_hash: String(plan.scope_hash),
    target_domain: String(target.registrable_domain),
    target_hostname: String(target.hostname),
    target_origin: String(target.origin),
    comparison_origin: scalarText(comparison.origin ?? ''),
    location_code: isBacklinkKind(kind) ? null : Number(request.location_code),
    language_code: isBacklinkKind(kind) ? '' : scalarText(request.language_code ?? ''),
    requested_rows: Number(plan.requested_rows),
    provider_filters: JSON.stringify({
      ...request,
      research_scope: plan.research_scope ?? 'exact_host',
    }),
    collection_started_at: at,
    collection_ended_at: null,
    published_at: null,
    parent_dataset_id: null,
    parser_version: si.parser_version,
    status: 'collecting',
    coverage: 'unknown',
    created_at: at,
    provider_total: null,
    raw_rows_received: 0,
    unique_rows_saved: 0,
    truncated: false,
    summary: JSON.stringify({}),
  };
}

/**
 * The dataset after one published page: its counts and summary, and, once the
 * plan has no later page for it or the provider ran out, its coverage.
 */
export function publishedPage(o: {
  dataset: Dataset;
  normalized: ReturnType<typeof normalizeResponse>;
  plan: ResearchPlan;
  later: ResearchPlan[];
  saved: number;
  callId: string;
  at: Date;
}) {
  const { dataset, normalized, plan, saved, at } = o;
  const received = dataset.raw_rows_received + normalized.received,
    exhausted = normalized.received < Number(record(plan.request).limit ?? 1),
    finished = !o.later.some((item) => item.dataset_key === plan.dataset_key) || exhausted;
  const kind = datasetKind(dataset.dataset_kind);
  const coverage = datasetCoverage({
    resultAvailable: Boolean(normalized.summary.result_available),
    received,
    kind,
    exhausted,
    saved,
    requested: dataset.requested_rows,
  });
  const total = normalized.total ?? dataset.provider_total;
  return {
    finished,
    update: {
      raw_rows_received: received,
      unique_rows_saved: saved,
      provider_total: total !== null && total > INT4_MAX ? null : total,
      summary: JSON.stringify({
        ...record(dataset.summary),
        ...normalized.summary,
        source_call_ids: [...strings(record(dataset.summary).source_call_ids), o.callId],
      }),
      ...(finished
        ? {
            status: 'published',
            coverage,
            truncated: isTruncated(coverage, kind, total, saved),
            collection_ended_at: at,
            published_at: at,
          }
        : {}),
    },
  };
}
