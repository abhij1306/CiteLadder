import { sql, type Selectable } from 'kysely';
import { z } from 'zod';

import type { Database } from '../db/database.ts';
import { jsonObject, strings } from '../db/json.ts';
import { currentIssueFilter } from '../site-health/reads/page-rows.ts';
import type { DB } from '../generated/db-schema.ts';
import { parseUuid } from '../http/uuid.ts';
import { effectiveStatus } from '../opportunities/action-status.ts';
import { getAction } from '../opportunities/actions.ts';
import { getExecutionEvidence } from '../visibility/execution.ts';
import { authorizedWorkspaceIds, authorizeProject } from './data.ts';
import { businessContext } from './context.ts';
import { appLink, recordPath } from './links.ts';
import { mcpPolicy } from './config.ts';
import { McpInputError, type Evidence, type EvidencePrincipal } from './types.ts';

type Descriptor = { table: keyof DB; columns: readonly string[]; title: string };
function descriptor<T extends keyof DB>(
  table: T,
  title: string,
  columns: readonly (keyof Selectable<DB[T]> & string)[],
): Descriptor {
  return { table, columns, title };
}
// Only these persisted projections can be fetched. No provider transports or
// credentials enter a retrieval document, even if the owning table grows.
const records = {
  opportunity: descriptor('opportunities', 'Opportunity', [
    'id',
    'project_id',
    'title',
    'remediation',
    'severity',
    'priority_score',
    'target_url',
    'evidence',
    'analyzer_version',
    'rule_version',
    'formula_version',
    'action_id',
    'created_at',
  ]),
  site_snapshot: descriptor('site_health_snapshots', 'Site Snapshot', [
    'id',
    'project_id',
    'crawl_id',
    'web_fundamentals_score',
    'aeo_readiness_score',
    'coverage_evidence',
    'coverage_state',
    'status_counts',
    'top_issues',
    'created_at',
  ]),
  site_crawl: descriptor('site_crawls', 'Site Crawl', [
    'id',
    'project_id',
    'status',
    'discovery_status',
    'analysis_status',
    'root_url',
    'admitted_url_count',
    'discovered_url_count',
    'analyzed_url_count',
    'failed_url_count',
    'inventory_complete',
    'partial_reason',
    'extractor_version',
    'analyzer_version',
    'rule_catalog_version',
    'scoring_version',
    'created_at',
    'completed_at',
  ]),
  site_page: descriptor('site_page_analyses', 'Site Page', [
    'id',
    'project_id',
    'crawl_id',
    'site_url_id',
    'artifact_id',
    'page_kind',
    'page_kind_evidence',
    'status',
    'web_fundamentals_score',
    'web_fundamentals_state',
    'web_fundamentals_coverage',
    'aeo_readiness_score',
    'aeo_measurement_state',
    'aeo_measurement_reason',
    'aeo_measurement_coverage',
    'readiness_dimensions',
    'source_artifact_ids',
    'source_evaluation_ids',
    'analyzer_version',
    'classifier_version',
    'scoring_version',
    'created_at',
  ]),
  site_issue: descriptor('site_issues', 'Site Issue', [
    'id',
    'project_id',
    'crawl_id',
    'site_url_id',
    'analysis_id',
    'evaluation_id',
    'source_artifact_id',
    'rule_id',
    'dimension',
    'category',
    'severity',
    'finding_class',
    'evidence',
    'description',
    'remediation',
    'analyzer_version',
    'rule_version',
    'created_at',
  ]),
  site_link: descriptor('site_page_link_metrics', 'Site Link', [
    'id',
    'project_id',
    'crawl_id',
    'site_url_id',
    'inbound_count',
    'outbound_count',
    'main_content_inbound_count',
    'main_content_outbound_count',
    'top_inbound',
    'top_outbound',
    'anchor_diagnostics',
    'extractor_version',
    'formula_version',
    'created_at',
  ]),
  demand_snapshot: descriptor('demand_snapshots', 'Demand Snapshot', [
    'id',
    'project_id',
    'window_start',
    'window_end',
    'summary',
    'coverage',
    'comparison',
    'analyzer_version',
    'created_at',
  ]),
  query_snapshot: descriptor('query_evidence_snapshots', 'Query Snapshot', [
    'id',
    'project_id',
    'window_start',
    'window_end',
    'state',
    'coverage',
    'limitations',
    'analyzer_version',
    'resolver_version',
    'created_at',
  ]),
  query_row: descriptor('query_evidence_rows', 'Query Row', [
    'id',
    'project_id',
    'snapshot_id',
    'date',
    'normalized_query',
    'observed_page_url',
    'site_url_id',
    'resolved_page_url',
    'resolution_outcome',
    'resolution_candidates',
    'impressions',
    'clicks',
    'ctr',
    'position',
    'source_metric_row_id',
    'source_artifact_id',
    'created_at',
  ]),
  audit: descriptor('audits', 'Audit', [
    'id',
    'project_id',
    'status',
    'benchmark_mode',
    'audit_scope',
    'requested_count',
    'completed_count',
    'failed_count',
    'summary',
    'analyzer_version',
    'created_at',
    'completed_at',
  ]),
  visibility_result: descriptor('audit_tasks', 'Visibility Result', [
    'id',
    'project_id',
    'audit_id',
    'logical_engine',
    'prompt_index',
    'answer_text',
    'search_events',
    'created_at',
    'completed_at',
  ]),
  traffic_snapshot: descriptor('traffic_snapshots', 'Traffic Snapshot', [
    'id',
    'project_id',
    'window_start',
    'window_end',
    'granularity',
    'metrics',
    'dimension_counts',
    'coverage',
    'formula_version',
    'normalization_version',
    'created_at',
  ]),
  search_run: descriptor('search_intelligence_runs', 'Search Run', [
    'id',
    'project_id',
    'status',
    'action',
    'frozen_scope',
    'pricing_version',
    'planned_calls',
    'completed_calls',
    'planned_rows',
    'received_rows',
    'uncertain_calls',
    'error_code',
    'created_at',
    'completed_at',
  ]),
  search_dataset: descriptor('search_intelligence_datasets', 'Search Dataset', [
    'id',
    'project_id',
    'run_id',
    'dataset_kind',
    'target_domain',
    'target_hostname',
    'target_origin',
    'comparison_origin',
    'location_code',
    'language_code',
    'provider_filters',
    'status',
    'coverage',
    'requested_rows',
    'raw_rows_received',
    'unique_rows_saved',
    'provider_total',
    'truncated',
    'summary',
    'collection_started_at',
    'collection_ended_at',
    'published_at',
    'created_at',
  ]),
  search_row: descriptor('search_intelligence_rows', 'Search Row', [
    'id',
    'project_id',
    'dataset_id',
    'call_id',
    'row_kind',
    'keyword',
    'domain',
    'url',
    'search_volume',
    'difficulty',
    'intent',
    'rank_group',
    'owned_rank_group',
    'etv',
    'backlinks',
    'referring_main_domains',
    'dataforseo_rank',
    'auxiliary',
    'created_at',
  ]),
} as const;
// Kinds resolved by their owners rather than the column allowlist.
const OWNED_KINDS = ['project', 'prompt', 'action'] as const;
const OWNED_KIND_NAMES: readonly string[] = OWNED_KINDS;
type Kind = keyof typeof records | (typeof OWNED_KINDS)[number];

const NOT_A_RECORD = 'id must be an allowlisted citeladder:// record URI';
export function parseRecordId(value: string): { kind: Kind; id: string; part: number } {
  const uri = URL.parse(value);
  if (!uri) throw new McpInputError(NOT_A_RECORD);
  const kind = uri.hostname;
  const id = parseUuid(uri.pathname.slice(1));
  if (
    uri.protocol !== 'citeladder:' ||
    uri.username ||
    uri.password ||
    uri.port ||
    uri.hash ||
    !id ||
    (!OWNED_KIND_NAMES.includes(kind) && !Object.hasOwn(records, kind))
  ) {
    throw new McpInputError(NOT_A_RECORD);
  }
  const parts = uri.searchParams.getAll('part');
  if (
    [...uri.searchParams.keys()].some((key) => key !== 'part') ||
    parts.length > 1 ||
    (parts[0] !== undefined && !/^\d+$/.test(parts[0]))
  )
    throw new McpInputError('Record URI contains unsupported parameters');
  const part = Number(parts[0] ?? 0);
  if (!Number.isSafeInteger(part))
    throw new McpInputError('Record part must be a non-negative integer');
  return { kind: kind as Kind, id, part };
}

const missing = () => new McpInputError('The requested record was not found in this account');
const text = (value: unknown) => (typeof value === 'string' ? value : '');
function jsonValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)]));
  return value;
}

type ResolvedRecord = { record: Evidence; title: string; projectId: string; observedAt: unknown };

async function resolveProject(
  db: Database,
  principal: EvidencePrincipal,
  id: string,
  origin: string,
): Promise<ResolvedRecord> {
  const record = await businessContext(db, principal, id, origin);
  return {
    record,
    title: text(jsonObject(record.project, 'project').name),
    projectId: id,
    observedAt: null,
  };
}

async function resolveAction(
  db: Database,
  principal: EvidencePrincipal,
  workspaces: string[],
  id: string,
): Promise<ResolvedRecord> {
  const row = await db
    .selectFrom('actions')
    .select(['id', 'workspace_id', 'project_id'])
    .where('id', '=', id)
    .where('workspace_id', 'in', workspaces)
    .executeTakeFirst();
  if (!row) throw missing();
  await authorizeProject(db, principal, row.project_id);
  const action = await getAction(db, row.workspace_id, row.id);
  return {
    record: action,
    title: action.target_label || 'Action',
    projectId: row.project_id,
    observedAt: action.updated_at,
  };
}

async function resolvePrompt(
  db: Database,
  principal: EvidencePrincipal,
  workspaces: string[],
  id: string,
): Promise<ResolvedRecord> {
  const row = await db
    .selectFrom('prompts as p')
    .innerJoin('prompt_sets as s', 's.id', 'p.prompt_set_id')
    .innerJoin('projects as project', 'project.id', 's.project_id')
    .select([
      'p.id',
      's.project_id',
      'p.text',
      'p.theme',
      'p.intent',
      'p.buyer_stage',
      'p.status',
      'p.origin',
      'p.generation_evidence',
      'p.created_at',
    ])
    .where('p.id', '=', id)
    .where('project.workspace_id', 'in', workspaces)
    .executeTakeFirst();
  if (!row) throw missing();
  await authorizeProject(db, principal, row.project_id);
  return {
    record: { ...row, type: 'prompt' },
    title: row.theme || 'Prompt',
    projectId: row.project_id,
    observedAt: row.created_at,
  };
}

/** Only a published dataset, or a row of one, is evidence. */
function publishedFilter(kind: Kind) {
  if (kind === 'search_dataset') return sql`and r.status = 'published'`;
  if (kind === 'search_row')
    return sql`and exists (select 1 from search_intelligence_datasets d where d.id = r.dataset_id and d.workspace_id = r.workspace_id and d.project_id = r.project_id and d.status = 'published')`;
  return sql``;
}

type AuthorizedProject = Awaited<ReturnType<typeof authorizeProject>>;
type RecordScope = { project: AuthorizedProject; projectId: string; id: string };

async function visibilityResult(
  db: Database,
  row: Evidence,
  { project, projectId, id }: RecordScope,
  observedAt: unknown,
): Promise<ResolvedRecord> {
  const audit = await db
    .selectFrom('audits')
    .select('id')
    .where('id', '=', text(row.audit_id))
    .where('workspace_id', '=', project.workspace_id)
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  if (!audit) throw missing();
  const evidence = await getExecutionEvidence(db, {
    workspaceId: project.workspace_id,
    taskId: id,
  });
  return {
    record: { ...evidence, answer_text: row.answer_text, search_events: row.search_events ?? [] },
    title: `${text(row.logical_engine)} answer for prompt ${Number(row.prompt_index) + 1}`,
    projectId,
    observedAt,
  };
}

async function attachActionStatus(
  db: Database,
  row: Evidence,
  { project, projectId }: RecordScope,
) {
  const status = row.action_id
    ? await db
        .selectFrom('actions')
        .select(effectiveStatus().as('status'))
        .where('id', '=', text(row.action_id))
        .where('workspace_id', '=', project.workspace_id)
        .where('project_id', '=', projectId)
        .executeTakeFirst()
    : undefined;
  // No Action row is an unknown status, never an open one.
  row.status = status?.status ?? null;
  row.provenance = {
    analyzer_version: row.analyzer_version,
    rule_version: row.rule_version,
    formula_version: row.formula_version,
  };
}

/** Columns each lifecycle record reports as its progress counts. */
const countColumns: Partial<Record<Kind, Record<string, string>>> = {
  site_crawl: {
    admitted: 'admitted_url_count',
    discovered: 'discovered_url_count',
    analyzed: 'analyzed_url_count',
    failed: 'failed_url_count',
  },
  audit: { requested: 'requested_count', completed: 'completed_count', failed: 'failed_count' },
  search_run: {
    planned_calls: 'planned_calls',
    completed_calls: 'completed_calls',
    planned_rows: 'planned_rows',
    received_rows: 'received_rows',
    uncertain_calls: 'uncertain_calls',
  },
};

/** Synchronous per-kind reshaping of the persisted row. */
const rowShapers: Partial<Record<Kind, (row: Evidence) => void>> = {
  site_snapshot: (row) => {
    row.scores = {
      web_fundamentals: row.web_fundamentals_score,
      aeo_readiness: row.aeo_readiness_score,
    };
    row.coverage = row.coverage_evidence;
    delete row.web_fundamentals_score;
    delete row.aeo_readiness_score;
    delete row.coverage_evidence;
  },
  site_link: (row) => {
    row.grain = 'page_link_metrics_with_bounded_neighbors';
  },
  query_row: (row) => {
    row.query = row.normalized_query;
    delete row.normalized_query;
  },
  search_dataset: (row) => {
    const filters = jsonObject(row.provider_filters, 'provider_filters');
    row.acquisition = filters;
    row.research_scope = filters.research_scope ?? 'exact_host';
    delete row.provider_filters;
  },
  search_row: (row) => {
    for (const [key, value] of Object.entries(jsonObject(row.auxiliary, 'auxiliary'))) {
      if (!Object.hasOwn(row, key)) row[key] = value;
    }
  },
};

function attachCounts(kind: Kind, row: Evidence) {
  const fields = countColumns[kind];
  if (!fields) return;
  row.counts = Object.fromEntries(
    Object.entries(fields).map(([name, column]) => [name, row[column]]),
  );
  for (const column of Object.values(fields)) delete row[column];
}

/** Attaches the page's artifact, rule evaluations and current issues; returns its title. */
async function attachSitePage(
  db: Database,
  row: Evidence,
  { project, projectId, id }: RecordScope,
  fallbackTitle: string,
) {
  const url = await db
    .selectFrom('site_urls')
    .select(['display_url', 'latest_title'])
    .where('id', '=', text(row.site_url_id))
    .where('workspace_id', '=', project.workspace_id)
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  if (!url) throw missing();
  const title = url.latest_title || url.display_url || fallbackTitle;
  Object.assign(row, url);
  const artifact = await db
    .selectFrom('site_fetch_artifacts')
    .select([
      'id',
      'requested_url',
      'final_url',
      'normalized_facts',
      'extractor_version',
      'fetched_at',
    ])
    .where('id', '=', text(row.artifact_id))
    .where('workspace_id', '=', project.workspace_id)
    .where('crawl_id', '=', text(row.crawl_id))
    .executeTakeFirst();
  row.artifact = artifact ?? null;
  row.evaluations = await db
    .selectFrom('site_rule_evaluations')
    .select([
      'id',
      'rule_id',
      'outcome',
      'reason_code',
      'dimension',
      'category',
      'severity',
      'finding_class',
      'evidence',
      'score_applicability',
      'display_applicability',
      'source_artifact_id',
      'supporting_artifact_ids',
      'analyzer_version',
      'extractor_version',
      'rule_version',
    ])
    .where((eb) => eb('id', '=', eb.fn.any(eb.val(strings(row.source_evaluation_ids)))))
    .where('workspace_id', '=', project.workspace_id)
    .orderBy('rule_id')
    .orderBy('id')
    .execute();
  row.issues = await db
    .selectFrom('site_issues')
    .select([
      'id as occurrence_id',
      'rule_id',
      'severity',
      'description',
      'remediation',
      'evidence',
      'evaluation_id',
      'source_artifact_id',
    ])
    .where(sql<boolean>`exists (
        select 1 from site_page_analyses a where a.id = ${id}::uuid
          and ${currentIssueFilter('site_issues', 'a')}
      )`)
    .where('workspace_id', '=', project.workspace_id)
    .where('project_id', '=', projectId)
    .where('crawl_id', '=', text(row.crawl_id))
    .where('site_url_id', '=', text(row.site_url_id))
    .orderBy('id')
    .execute();
  row.issues = (row.issues as Evidence[]).map((issue) => ({
    ...issue,
    record_uri: `citeladder://site_issue/${text(issue.occurrence_id)}`,
  }));
  return title;
}

async function resolveSpecRecord(
  db: Database,
  principal: EvidencePrincipal,
  workspaces: string[],
  kind: keyof typeof records,
  id: string,
): Promise<ResolvedRecord> {
  const spec = records[kind];
  const workspaceIds = sql.join(workspaces.map((workspace) => sql`${workspace}::uuid`));
  const scope = sql`r.workspace_id in (${workspaceIds})`;
  const selected = sql.join([
    ...spec.columns.map((column) => sql.ref(`r.${column}`)),
    sql`r.workspace_id`,
  ]);
  const published = publishedFilter(kind);
  const row = (
    await sql<Evidence>`select ${selected} from ${sql.table(spec.table)} r where r.id = ${id}::uuid and ${scope} ${published}`.execute(
      db,
    )
  ).rows[0];
  if (!row) throw missing();
  const projectId = text(row.project_id);
  const project = await authorizeProject(db, principal, projectId);
  if (project.workspace_id !== row.workspace_id) throw missing();
  const observedAt = row.completed_at ?? row.published_at ?? row.created_at ?? null;
  let title = text(row.title) || text(row.description) || spec.title;
  delete row.workspace_id;
  const recordScope: RecordScope = { project, projectId, id };
  if (kind === 'visibility_result') return visibilityResult(db, row, recordScope, observedAt);
  if (kind === 'opportunity') await attachActionStatus(db, row, recordScope);
  attachCounts(kind, row);
  rowShapers[kind]?.(row);
  if (kind === 'site_page') title = await attachSitePage(db, row, recordScope, title);
  // Put the diagnosis ahead of bulky crawl facts in continuation documents.
  const record =
    kind === 'site_page' ? { issues: row.issues, evaluations: row.evaluations, ...row } : row;
  return { record, title, projectId, observedAt };
}

async function resolveRecord(
  db: Database,
  principal: EvidencePrincipal,
  kind: Kind,
  id: string,
  origin: string,
): Promise<ResolvedRecord> {
  if (kind === 'project') return resolveProject(db, principal, id, origin);
  const workspaces = await authorizedWorkspaceIds(db, principal);
  if (!workspaces.length) throw missing();
  if (kind === 'action') return resolveAction(db, principal, workspaces, id);
  if (kind === 'prompt') return resolvePrompt(db, principal, workspaces, id);
  return resolveSpecRecord(db, principal, workspaces, kind, id);
}

/** Split by Unicode code points, measuring the entire encoded document in UTF-8. */
export function retrievalDocument({
  kind,
  id,
  part,
  record,
  title,
  projectId,
  observedAt,
  origin,
  maxBytes = mcpPolicy.max_document_bytes,
}: {
  kind: Kind;
  id: string;
  part: number;
  record: Evidence;
  title: string;
  projectId: string;
  observedAt: unknown;
  origin: string;
  maxBytes?: number;
}): Evidence {
  const normalized = z.record(z.string(), z.json()).parse(jsonValue(record));
  const serialized = JSON.stringify(normalized);
  const uri = `citeladder://${kind}/${id}`;
  const url = appLink(origin, recordPath(kind, normalized), projectId);
  const limit = Math.min(maxBytes, mcpPolicy.max_document_bytes);
  // The record travels once, as the document text.
  const document = (textPart: string, partUris: string[] = []) => ({
    id: partUris.length ? `${uri}?part=${part}` : uri,
    title,
    text: textPart,
    url,
    metadata: {
      project_id: projectId,
      record_type: kind,
      observed_at: jsonValue(observedAt),
      complete: partUris.length === 0,
      part: partUris.length ? part : null,
      part_count: partUris.length || 1,
      part_uris: partUris,
    },
  });
  const bytes = (value: Evidence) => Buffer.byteLength(JSON.stringify(value), 'utf8');
  const full = document(serialized);
  if (bytes(full) <= limit) {
    if (part !== 0) throw new McpInputError('The requested evidence part was not found');
    return full;
  }
  const characters = Array.from(serialized);
  for (
    let chunkSize = Math.floor(limit / 2);
    chunkSize > 0;
    chunkSize = Math.floor(chunkSize / 2)
  ) {
    const count = Math.ceil(characters.length / chunkSize);
    const uris = Array.from({ length: count }, (_, index) => `${uri}?part=${index}`);
    // Bound metadata first: decreasing chunk size cannot rescue a URI manifest
    // that already exceeds the document budget.
    if (bytes(document('', uris)) > limit)
      throw new Error('Retrieval metadata exceeds the document size limit');
    const parts = Array.from({ length: count }, (_, index) =>
      characters.slice(index * chunkSize, (index + 1) * chunkSize).join(''),
    );
    if (parts.every((entry) => bytes(document(entry, uris)) <= limit)) {
      if (part >= count) throw new McpInputError('The requested evidence part was not found');
      return document(parts[part]!, uris);
    }
  }
  throw new Error('Retrieval metadata exceeds the document size limit');
}

export async function fetchRecord(
  db: Database,
  principal: EvidencePrincipal,
  value: string,
  origin: string,
  maxBytes = mcpPolicy.max_document_bytes,
): Promise<Evidence> {
  const { kind, id, part } = parseRecordId(value);
  const resolved = await resolveRecord(db, principal, kind, id, origin);
  return retrievalDocument({
    kind,
    id,
    part,
    record: resolved.record,
    title: resolved.title,
    projectId: resolved.projectId,
    observedAt: resolved.observedAt,
    origin,
    maxBytes,
  });
}
