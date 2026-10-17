/**
 * Readings of a `keyword_presence` check: whether the project now appears for a
 * search a competitor ranked for. Search Console impressions in a window after
 * go-live answer it; so does an owned ranking in a later Search Intelligence
 * dataset, but only when the provider checked the search after go-live. Not
 * appearing yet is `waiting`, never a failure, and no reading is unknown.
 */
import { sql } from 'kysely';
import type { KeywordPresenceCheck } from '@citeladder/contracts/opportunities';
import { lexicalTokens } from '../analysis/lexical.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import type { WorkspaceScope } from '../db/workspace-scope.ts';
import { normalizeQuery } from '../demand/classification.ts';
import { compareText, scalarText } from '../text-order.ts';
import { scopedDailyRate, windowDays } from './traffic-scope.ts';
import {
  outcome,
  type CheckOutcome,
  type Evaluation,
  type Reading,
} from './verification-decisions.ts';
import type { Declaration } from './verification-result.ts';

type Check = KeywordPresenceCheck;
type Reader = {
  db: Database;
  scope: WorkspaceScope;
  declaration: Declaration;
  reading: Reading;
  result: Evaluation;
};

/** Search Console impressions for the search in a window that starts after go-live. */
export async function keywordTrafficOutcome(
  r: Reader,
  snapshotId: string,
  check: Check,
): Promise<CheckOutcome> {
  const d = r.declaration;
  const key = check.query_key;
  const snapshot = await r.scope
    .selectFrom(r.db, 'traffic_snapshots')
    .select(['id', sql<string>`window_start::date::text`.as('start'), windowDays.as('days')])
    .where('project_id', '=', d.project_id)
    .where('id', '=', snapshotId)
    .executeTakeFirst();
  if (!snapshot) return outcome(r.reading, 'unavailable', 'no_traffic_snapshot');
  if (snapshot.start <= d.declared_implemented_at.slice(0, 10))
    return outcome(r.reading, 'unavailable', 'window_overlaps_declaration');
  const { rowId, rate } = await scopedDailyRate(
    r.db,
    { workspaceId: d.workspace_id, projectId: d.project_id },
    snapshot,
    { scope: 'query', key, metric: 'impressions' },
  );
  if (rowId) r.result.metric_ids.add(rowId);
  // Search Console reports no row for a search with no impressions: unknown, not a miss.
  return rate !== null && rate > 0
    ? outcome(r.reading, 'met')
    : outcome(r.reading, 'unavailable', 'no_search_console_row');
}

/** DataForSEO's "2026-09-01 12:00:00 +00:00" as an instant, or null. */
function providerInstant(value: unknown): number | null {
  const text = scalarText(value).trim();
  if (!text) return null;
  const iso = text.replace(' ', 'T').replace(/ ([+-]\d{2}):?(\d{2})$/u, '$1:$2');
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : null;
}

/**
 * A search's identity regardless of case, punctuation and word order: how keyword
 * gaps merge rows, so a later row for the same search is found the same way.
 */
export function searchTerms(keyword: string) {
  const normalized = normalizeQuery(keyword);
  const tokens = [...lexicalTokens(normalized)].sort(compareText);
  return { key: tokens.join(' ') || normalized, tokens };
}

/** Where each dataset kind records the project's own rank for a search. */
export const OWNED_RANK: Record<string, 'rank_group' | 'owned_rank_group'> = {
  ranking_keywords: 'rank_group',
  shared_keywords: 'owned_rank_group',
};

/** A later Search Intelligence dataset for the same website and market. */
export async function keywordDatasetOutcome(
  r: Reader,
  datasetId: string,
  check: Check,
): Promise<CheckOutcome | null> {
  const d = r.declaration;
  const dataset = await r.scope
    .selectFrom(r.db, 'search_intelligence_datasets')
    .select(['id', 'dataset_kind', 'coverage', 'truncated', 'target_origin'])
    .select(['location_code', 'language_code'])
    .where('project_id', '=', d.project_id)
    .where('id', '=', datasetId)
    .where('status', '=', 'published')
    .executeTakeFirst();
  if (
    !dataset ||
    dataset.target_origin !== check.owned_origin ||
    dataset.location_code !== check.location_code ||
    dataset.language_code !== check.language_code
  )
    return null;
  const { keyword } = check;
  const { key, tokens } = searchTerms(keyword);
  // Narrow by the longest term in SQL; the term set decides in code.
  const probe = tokens.reduce(
    (longest, term) => (term.length > longest.length ? term : longest),
    '',
  );
  const rows = (
    await r.scope
      .selectFrom(r.db, 'search_intelligence_rows')
      .select(['id', 'keyword', 'rank_group', 'owned_rank_group', 'auxiliary'])
      .where('project_id', '=', d.project_id)
      .where('dataset_id', '=', dataset.id)
      .where((eb) =>
        probe
          ? eb(sql<number>`strpos(lower(keyword), ${probe})`, '>', 0)
          : eb('keyword', '=', keyword),
      )
      .execute()
  ).filter((row) => searchTerms(row.keyword).key === key);
  const goLive = Date.parse(d.declared_implemented_at);
  const fresh = (row: { auxiliary: unknown }) => {
    const checkedAt = providerInstant(record(row.auxiliary).serp_updated_at);
    return checkedAt !== null && checkedAt > goLive;
  };
  const rankColumn = OWNED_RANK[dataset.dataset_kind];
  if (rankColumn) {
    const ranked = rows.find((row) => row[rankColumn] !== null);
    if (ranked) {
      r.result.metric_ids.add(ranked.id);
      return fresh(ranked)
        ? outcome(r.reading, 'met')
        : outcome(r.reading, 'unavailable', 'provider_serp_predates_change');
    }
    // A complete ranking list without the search says "not yet"; a cut one says nothing.
    return dataset.dataset_kind === 'ranking_keywords' &&
      dataset.coverage === 'complete' &&
      !dataset.truncated
      ? outcome(r.reading, 'waiting', 'not_ranking_yet')
      : null;
  }
  if (dataset.dataset_kind === 'missing_keywords') {
    const gap = rows.find(fresh);
    if (!gap) return null;
    r.result.metric_ids.add(gap.id);
    return outcome(r.reading, 'waiting', 'still_missing');
  }
  return null;
}
