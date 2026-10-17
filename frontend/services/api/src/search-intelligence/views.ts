/** Published views of persisted Search Intelligence runs, datasets and rows. */
import {
  searchDatasetSchema,
  type searchRowSchema,
  type searchRunSchema,
} from '@citeladder/contracts/search-intelligence';
import type { Selectable } from 'kysely';
import type { z } from 'zod';

import { jsonObject, jsonObjects } from '../db/json.ts';
import type {
  SearchIntelligenceDatasets,
  SearchIntelligenceRows,
  SearchIntelligenceRuns,
} from '../generated/db-schema.ts';

type Run = Selectable<SearchIntelligenceRuns>;
type Dataset = Selectable<SearchIntelligenceDatasets>;
type Row = Selectable<SearchIntelligenceRows>;

const researchScope = searchDatasetSchema.shape.research_scope;
// Datasets published before scope was recorded were exact-host research.
const UNRECORDED_RESEARCH_SCOPE = 'exact_host';

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

export function runView(run: Run): z.input<typeof searchRunSchema> {
  return {
    id: run.id,
    status: run.status,
    action: run.action,
    pricing_version: run.pricing_version,
    estimated_cost_usd: run.estimated_cost_usd,
    provider_reported_cost_usd: run.provider_reported_cost_usd,
    planned_calls: run.planned_calls,
    completed_calls: run.completed_calls,
    planned_rows: run.planned_rows,
    received_rows: run.received_rows,
    uncertain_calls: run.uncertain_calls,
    error_code: run.error_code,
    error_detail: run.error_detail,
    expires_at: run.expires_at.toISOString(),
    confirmed_at: iso(run.confirmed_at),
    cancelled_at: iso(run.cancelled_at),
    completed_at: iso(run.completed_at),
    frozen_scope: jsonObject(run.frozen_scope, 'search_intelligence_runs.frozen_scope'),
    call_plan: jsonObjects(run.call_plan, 'search_intelligence_runs.call_plan'),
    reused_datasets: jsonObjects(run.reused_datasets, 'search_intelligence_runs.reused_datasets'),
    created_at: run.created_at.toISOString(),
  };
}

export function datasetView(dataset: Dataset): z.input<typeof searchDatasetSchema> {
  const acquisition = jsonObject(
    dataset.provider_filters,
    'search_intelligence_datasets.provider_filters',
  );
  const summary = jsonObject(dataset.summary, 'search_intelligence_datasets.summary');
  // A provider total beyond the integer column is kept in the summary.
  const oversizedTotal = typeof summary.provider_total === 'number' ? summary.provider_total : null;
  return {
    id: dataset.id,
    run_id: dataset.run_id,
    dataset_kind: dataset.dataset_kind,
    target_domain: dataset.target_domain,
    target_hostname: dataset.target_hostname,
    target_origin: dataset.target_origin,
    research_scope: researchScope.parse(acquisition.research_scope ?? UNRECORDED_RESEARCH_SCOPE),
    acquisition,
    comparison_origin: dataset.comparison_origin,
    location_code: dataset.location_code,
    language_code: dataset.language_code,
    status: dataset.status,
    coverage: dataset.coverage,
    requested_rows: dataset.requested_rows,
    raw_rows_received: dataset.raw_rows_received,
    unique_rows_saved: dataset.unique_rows_saved,
    provider_total: dataset.provider_total ?? oversizedTotal,
    truncated: dataset.truncated,
    summary,
    collection_started_at: iso(dataset.collection_started_at),
    collection_ended_at: iso(dataset.collection_ended_at),
    published_at: iso(dataset.published_at),
  };
}

/** A row's auxiliary metrics beside its typed columns; the typed columns win. */
export function rowView(row: Row): z.input<typeof searchRowSchema> {
  const auxiliary = jsonObject(row.auxiliary, 'search_intelligence_rows.auxiliary');
  return {
    ...auxiliary,
    id: row.id,
    dataset_id: row.dataset_id,
    call_id: row.call_id,
    row_kind: row.row_kind,
    keyword: row.keyword,
    domain: row.domain,
    url: row.url,
    search_volume: row.search_volume,
    difficulty: row.difficulty,
    intent: row.intent,
    rank_group: row.rank_group,
    owned_rank_group: row.owned_rank_group,
    etv: row.etv,
    backlinks: row.backlinks,
    referring_main_domains: row.referring_main_domains,
    dataforseo_rank: row.dataforseo_rank,
    auxiliary,
  };
}
