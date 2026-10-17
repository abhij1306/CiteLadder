/**
 * Per-answer evidence for a selection: mentions, citations and query fanout.
 *
 * Shared API/MCP reader of persisted rows: stored search events are
 * normalized, never invented, and an answer's fanout state distinguishes
 * query text, a count alone, no search, and an engine that exposes nothing.
 * Pages are keyset cursors bound to the selection, its filters and `as_of`.
 */
import { citationClassificationSchema } from '@citeladder/contracts/audits';
import type { visibilityEvidenceResponseSchema } from '@citeladder/contracts/visibility-evidence';
import { sql } from 'kysely';
import type { z } from 'zod';

import { executionFrozenProvenance } from '../analysis/provenance.ts';
import { fanoutState, selectEvents } from '../analysis/fanout.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { wireUtcOf, wireUtcOrNull, utcText, utcTextOf } from '../db/timestamps.ts';
import { fromEpochMicros, type ParsedDatetime } from '../http/datetimes.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../http/keyset-cursor.ts';
import { parseUuid } from '../http/uuid.ts';
import { compareText } from '../text-order.ts';
import {
  authorizedSelection,
  evidenceScope,
  readsMarket,
  selectedCohorts,
  TrendQueryError,
  type RunSelection,
} from './selection.ts';

export type VisibilityEvidenceResponse = z.input<typeof visibilityEvidenceResponseSchema>;
type EvidenceItem = VisibilityEvidenceResponse['items'][number];

// --- The paged evidence read -----------------------------------------------

export type EvidenceFilters = {
  promptId: string | null;
  outcome: 'brand_absent' | 'uncited' | 'competitor_gap' | null;
  competitor: string | null;
  domain: string | null;
  url: string | null;
};

type Scope = ReturnType<typeof evidenceScope>;

function applyFilters(base: Scope, filters: EvidenceFilters): Scope {
  let statement = base;
  if (filters.outcome === 'competitor_gap' && !filters.competitor) {
    throw new TrendQueryError('A competitor is required for a competitor gap');
  }
  if (filters.outcome === 'brand_absent' || filters.outcome === 'competitor_gap') {
    statement = statement.where('ra.brand_mentioned', '=', false);
  }
  if (filters.outcome === 'uncited') {
    statement = statement
      .where('ra.brand_mentioned', '=', true)
      .where('ra.owned_domain_cited', '=', false);
  }
  if (filters.competitor) {
    const competitor = filters.competitor;
    statement = statement.where(({ exists, selectFrom }) =>
      exists(
        selectFrom('competitor_mentions as mention')
          .select('mention.id')
          .whereRef('mention.analysis_id', '=', 'ra.id')
          .where('mention.competitor_name', '=', competitor),
      ),
    );
  }
  if (filters.domain || filters.url) {
    statement = statement.where(({ exists, selectFrom }) => {
      let citation = selectFrom('citations as cited')
        .select('cited.id')
        .whereRef('cited.analysis_id', '=', 'ra.id');
      if (filters.domain) citation = citation.where('cited.domain', '=', filters.domain);
      if (filters.url) citation = citation.where('cited.url', '=', filters.url);
      return exists(citation);
    });
  }
  if (filters.promptId) {
    const promptId = filters.promptId;
    // A deleted prompt's answers are found by the frozen text its snapshot kept.
    const frozenText = base
      .clearSelect()
      .select('snapshot.text')
      .where('snapshot.id', '=', promptId)
      .where('snapshot.prompt_id', 'is', null);
    statement = statement.where((eb) =>
      eb.or([
        eb('snapshot.prompt_id', '=', promptId),
        eb('snapshot.id', '=', promptId),
        eb.and([eb('snapshot.prompt_id', 'is', null), eb('snapshot.text', 'in', frozenText)]),
      ]),
    );
  }
  return statement;
}

const CURSOR_SCOPE = 'visibility-evidence';
const UTC_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/u;

function cursorPosition(
  cursor: string,
  filters: Record<string, unknown>,
): { createdAt: string; id: string } {
  try {
    const [createdAt, id] = decodeKeysetCursor(cursor, CURSOR_SCOPE, filters);
    const uuid = id === undefined ? null : parseUuid(id);
    if (createdAt === undefined || !UTC_TEXT.test(createdAt) || uuid === null) {
      throw new InvalidCursorError('invalid cursor');
    }
    return { createdAt, id: uuid };
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw new TrendQueryError('Invalid evidence cursor for this selection');
    }
    throw error;
  }
}

export async function getVisibilityEvidence(
  db: Database,
  requested: RunSelection,
  options: EvidenceFilters & { cursor: string | null; asOf: ParsedDatetime | null; limit: number },
): Promise<VisibilityEvidenceResponse> {
  const selection = await authorizedSelection(db, requested);
  if (options.asOf !== null && options.asOf.offsetSeconds === null) {
    throw new TrendQueryError("'as_of' must be timezone-aware");
  }
  const asOf = wireUtcOf(options.asOf ?? fromEpochMicros(BigInt(Date.now()) * 1000n));
  const base = evidenceScope(db, selection).where(
    'ra.created_at',
    '<=',
    sql<Date>`${asOf}::timestamptz`,
  );
  let promptScope = db
    .selectFrom('audit_prompt_snapshots as snapshot')
    .innerJoin('audits as audit', 'audit.id', 'snapshot.audit_id')
    .where('audit.workspace_id', '=', selection.workspaceId)
    .where('audit.project_id', '=', selection.projectId)
    .where('audit.status', 'in', policy.visibility.dashboard_audit_statuses)
    .where('snapshot.cohort', 'in', [...selectedCohorts(selection.cohort)])
    .where('snapshot.created_at', '<=', sql<Date>`${asOf}::timestamptz`);
  if (selection.auditId) promptScope = promptScope.where('audit.id', '=', selection.auditId);
  if (selection.auditIds?.length)
    promptScope = promptScope.where('audit.id', 'in', selection.auditIds);
  if (readsMarket(selection))
    promptScope = promptScope.where('audit.market_id', 'is not distinct from', selection.marketId);
  if (selection.fromAt)
    promptScope = promptScope.where(
      'audit.completed_at',
      '>=',
      sql<Date>`${wireUtcOf(selection.fromAt)}::timestamptz`,
    );
  if (selection.toAt)
    promptScope = promptScope.where(
      'audit.completed_at',
      '<=',
      sql<Date>`${wireUtcOf(selection.toAt)}::timestamptz`,
    );
  const promptChoices = await promptScope
    .select([
      sql<string>`coalesce(snapshot.prompt_id, snapshot.id)`.as('identity'),
      'snapshot.text',
    ])
    .distinct()
    .execute();
  const statement = applyFilters(base, options);
  const fingerprint = {
    workspace: selection.workspaceId,
    project: selection.projectId,
    audit: selection.auditId,
    audit_ids: [...(selection.auditIds ?? [])].sort(compareText),
    prompt: options.promptId,
    engine: selection.logicalEngine,
    from: selection.fromAt && wireUtcOf(selection.fromAt),
    to: selection.toAt && wireUtcOf(selection.toAt),
    cohort: selection.cohort,
    as_of: asOf,
    outcome: options.outcome,
    competitor: options.competitor,
    domain: options.domain,
    url: options.url,
  };
  const matched = statement
    .leftJoin('raw_response_artifacts as artifact', 'artifact.id', 'ra.artifact_id')
    .select([
      sql<number>`count(*) over ()::int`.as('total'),
      'ra.id as analysis_id',
      'ra.audit_id',
      'ra.task_id',
      'ra.artifact_id',
      'ra.prompt_index',
      'ra.repetition',
      'ra.logical_engine',
      'ra.transport_provider',
      'ra.transport_model',
      'ra.search_used',
      'ra.search_query_count',
      utcTextOf(sql.ref('ra.created_at')).as('created_at'),
      'task.search_events as task_events',
      'task.provider_metadata',
      'task.request_snapshot',
      'task.provider_route_snapshot',
      'snapshot.id as prompt_snapshot_id',
      'snapshot.prompt_id',
      'snapshot.text as prompt_text',
      utcText(sql.ref('audit.completed_at')).as('completed_at'),
      'audit.configuration',
      'artifact.search_events as artifact_events',
    ])
    .as('matched');
  let page = db.selectFrom(matched).selectAll();
  if (options.cursor) {
    const position = cursorPosition(options.cursor, fingerprint);
    page = page.where(
      sql<boolean>`(matched.created_at, matched.analysis_id) < (${position.createdAt}, ${position.id}::uuid)`,
    );
  }
  const rows = await page
    .orderBy('created_at', 'desc')
    .orderBy('analysis_id', 'desc')
    .limit(options.limit + 1)
    .execute();
  const truncated = rows.length > options.limit;
  const shown = rows.slice(0, options.limit);
  const ids = shown.map((row) => row.analysis_id);
  const mentions = await mentionsByAnalysis(db, selection.workspaceId, ids);
  const citations = await citationsByAnalysis(db, selection.workspaceId, ids);
  // One label per prompt; a prompt renamed within the selection shows one text.
  const prompts = new Map<string, string>();
  for (const option of promptChoices) prompts.set(option.identity, option.text);
  const last = shown.at(-1);
  return {
    items: shown.map((row) => {
      const { events, source } = selectEvents(row.artifact_events, row.task_events);
      const searchQueryCount = row.search_query_count ?? 0;
      const { queryTextAvailable, state } = fanoutState({
        events,
        searchUsed: Boolean(row.search_used),
        searchQueryCount,
        providerMetadata: row.provider_metadata,
      });
      return {
        audit_id: row.audit_id,
        task_id: row.task_id,
        analysis_id: row.analysis_id,
        artifact_id: row.artifact_id,
        prompt_snapshot_id: row.prompt_snapshot_id,
        prompt_id: row.prompt_id,
        prompt_index: row.prompt_index,
        prompt_text: row.prompt_text || '',
        repetition: row.repetition,
        completed_at: wireUtcOrNull(row.completed_at),
        logical_engine: row.logical_engine,
        transport_provider: row.transport_provider,
        transport_model: row.transport_model,
        retrieval_enabled: executionFrozenProvenance({
          requestSnapshot: row.request_snapshot,
          routeSnapshot: row.provider_route_snapshot,
          auditConfiguration: row.configuration,
        }),
        search_used: Boolean(row.search_used),
        search_query_count: searchQueryCount,
        query_text_available: queryTextAvailable,
        state,
        search_events: events,
        event_source: source,
        mentions: mentions.get(row.analysis_id) ?? [],
        citations: citations.get(row.analysis_id) ?? [],
      };
    }),
    truncated,
    ...(rows[0] ? { total: rows[0].total } : {}),
    as_of: asOf,
    next_cursor:
      truncated && last
        ? encodeKeysetCursor(CURSOR_SCOPE, fingerprint, [last.created_at, last.analysis_id])
        : null,
    prompt_options: [...prompts]
      .map(([id, label]) => ({ id, label }))
      .sort((left, right) => compareText(left.label, right.label)),
  };
}

type Mention = EvidenceItem['mentions'][number];

/** Brand then competitor mentions per answer, each in recorded order. */
async function mentionsByAnalysis(
  db: Database,
  workspaceId: string,
  analysisIds: readonly string[],
): Promise<Map<string, Mention[]>> {
  const grouped = new Map<string, Mention[]>();
  if (analysisIds.length === 0) return grouped;
  const brand = await db
    .selectFrom('brand_mentions')
    .select([
      'analysis_id',
      'brand_name as name',
      'first_offset',
      'artifact_id',
      'analyzer_version',
    ])
    .where('workspace_id', '=', workspaceId)
    .where('analysis_id', 'in', [...analysisIds])
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const competitor = await db
    .selectFrom('competitor_mentions')
    .select([
      'analysis_id',
      'competitor_name as name',
      'first_offset',
      'artifact_id',
      'analyzer_version',
    ])
    .where('workspace_id', '=', workspaceId)
    .where('analysis_id', 'in', [...analysisIds])
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  for (const [kind, rows] of [
    ['brand', brand],
    ['competitor', competitor],
  ] as const) {
    for (const row of rows) {
      const list = grouped.get(row.analysis_id) ?? [];
      list.push({
        kind,
        name: row.name || '',
        first_offset: row.first_offset,
        artifact_id: row.artifact_id,
        analyzer_version: row.analyzer_version || '',
      });
      grouped.set(row.analysis_id, list);
    }
  }
  return grouped;
}

type Citation = EvidenceItem['citations'][number];

async function citationsByAnalysis(
  db: Database,
  workspaceId: string,
  analysisIds: readonly string[],
): Promise<Map<string, Citation[]>> {
  const grouped = new Map<string, Citation[]>();
  if (analysisIds.length === 0) return grouped;
  const rows = await db
    .selectFrom('citations')
    .select([
      'analysis_id',
      'ordinal',
      'url',
      'title',
      'domain',
      'classification',
      'source_class',
      'source_origin',
      'source_taxonomy_version',
      'is_owned',
      'is_unintended',
      'matched_competitor',
    ])
    .where('workspace_id', '=', workspaceId)
    .where('analysis_id', 'in', [...analysisIds])
    .orderBy('analysis_id')
    .orderBy('ordinal')
    .execute();
  for (const { analysis_id: analysisId, ...citation } of rows) {
    const list = grouped.get(analysisId) ?? [];
    list.push({
      ...citation,
      classification: citationClassificationSchema.parse(citation.classification),
    });
    grouped.set(analysisId, list);
  }
  return grouped;
}
