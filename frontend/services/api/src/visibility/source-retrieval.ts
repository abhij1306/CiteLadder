/**
 * What the engines read, beside what they cited.
 *
 * Only an answer whose surface exposes its reads (`retrieval_observed`) says
 * anything about retrieval: an engine that exposes none is unknown, never a
 * read of zero. A page counts as cited in an answer when the same answer
 * cites the same page identity.
 */
import type { visibilitySourceNearMissesSchema } from '@citeladder/contracts/visibility-evidence';
import { sql } from 'kysely';
import type { z } from 'zod';

import type { Database } from '../db/database.ts';
import { utcTextOf, wireUtc } from '../db/timestamps.ts';
import { compareText } from '../text-order.ts';
import { authorizedSelection, evidenceScope, observedAt, type RunSelection } from './selection.ts';

export type RetrievalCoverage = { responses: number; unavailable_engines: string[] };
type NearMisses = z.input<typeof visibilitySourceNearMissesSchema>;

/** The selection's answers up to `as_of` that exposed their reads. */
function observedScope(db: Database, selection: RunSelection, asOf: string) {
  return evidenceScope(db, selection)
    .where('ra.created_at', '<=', sql<Date>`${asOf}::timestamptz`)
    .where('ra.retrieval_observed', '=', true)
    .select(['ra.id as analysis_id', observedAt.as('observed_at')])
    .as('observed');
}

export async function retrievalCoverage(
  db: Database,
  selection: RunSelection,
  asOf: string,
): Promise<RetrievalCoverage> {
  const row = await evidenceScope(db, selection)
    .where('ra.created_at', '<=', sql<Date>`${asOf}::timestamptz`)
    .select([
      sql<number>`count(*) filter (where ra.retrieval_observed)::int`.as('responses'),
      sql<
        string[] | null
      >`array_agg(distinct ra.logical_engine) filter (where not ra.retrieval_observed)`.as(
        'unavailable',
      ),
    ])
    .executeTakeFirstOrThrow();
  return {
    responses: row.responses,
    unavailable_engines: [...(row.unavailable ?? [])].sort(compareText),
  };
}

type RetrievedRow = { key: string; url_hash: string | null; retrieved: number | null };

/**
 * Each loaded row's count of answers that read it, in place. A domain row
 * matches by domain, a page row by page identity; a page without one, or a
 * selection with no exposed reads, stays unknown.
 */
export async function attachRetrieved(
  db: Database,
  selection: RunSelection,
  input: { asOf: string; pages: boolean; coverage: RetrievalCoverage; items: RetrievedRow[] },
): Promise<void> {
  const { items, pages } = input;
  if (input.coverage.responses === 0) {
    for (const row of items) row.retrieved = null;
    return;
  }
  const keys = items
    .map((row) => (pages ? row.url_hash : row.key))
    .filter((key): key is string => Boolean(key));
  const counts = new Map<string, number>();
  if (keys.length) {
    const column = pages ? 'source.url_hash' : 'source.domain';
    const rows = await db
      .selectFrom('retrieved_sources as source')
      .innerJoin(
        observedScope(db, selection, input.asOf),
        'observed.analysis_id',
        'source.analysis_id',
      )
      .where('source.workspace_id', '=', selection.workspaceId)
      .where(column, 'in', keys)
      .select([
        sql<string>`${sql.ref(column)}`.as('key'),
        sql<number>`count(distinct source.analysis_id)::int`.as('retrieved'),
      ])
      .groupBy(column)
      .execute();
    for (const row of rows) counts.set(row.key, row.retrieved);
  }
  for (const row of items) {
    const key = pages ? row.url_hash : row.key;
    row.retrieved = key ? (counts.get(key) ?? 0) : null;
  }
}

/**
 * The project's own pages read in more answers than cited them, most missed
 * first: where the page reached the engine and still lost the citation.
 */
export async function getSourceNearMisses(
  db: Database,
  requested: RunSelection,
  query: { asOf: string; limit: number },
): Promise<NearMisses> {
  const selection = await authorizedSelection(db, requested);
  const coverage = await retrievalCoverage(db, selection, query.asOf);
  if (coverage.responses === 0) return { ...coverage, items: [] };
  const citedInSameAnswer = sql<boolean>`exists (
    select 1 from citations citation
    where citation.workspace_id = source.workspace_id
      and citation.analysis_id = source.analysis_id
      and citation.url_hash = source.url_hash)`;
  const rows = await db
    .selectFrom('retrieved_sources as source')
    .innerJoin(
      observedScope(db, selection, query.asOf),
      'observed.analysis_id',
      'source.analysis_id',
    )
    .where('source.workspace_id', '=', selection.workspaceId)
    .where('source.is_owned', '=', true)
    .where('source.url_hash', 'is not', null)
    .select([
      'source.url_hash',
      sql<string>`min(source.url)`.as('url'),
      sql<string>`min(source.domain)`.as('domain'),
      sql<string>`max(source.title)`.as('title'),
      sql<number>`count(distinct source.analysis_id)::int`.as('retrieved'),
      sql<number>`count(distinct source.analysis_id) filter (where ${citedInSameAnswer})::int`.as(
        'cited',
      ),
      utcTextOf(sql`max(observed.observed_at)`).as('last_retrieved_at'),
    ])
    .groupBy('source.url_hash')
    .having(
      sql<boolean>`count(distinct source.analysis_id) filter (where not ${citedInSameAnswer}) > 0`,
    )
    .orderBy(
      sql`count(distinct source.analysis_id) filter (where not ${citedInSameAnswer})`,
      'desc',
    )
    .orderBy(sql`min(source.url) collate "C"`)
    .limit(query.limit)
    .execute();
  return {
    ...coverage,
    items: rows.map((row) => ({
      url: row.url,
      url_hash: row.url_hash,
      domain: row.domain,
      title: row.title,
      retrieved: row.retrieved,
      cited: row.cited,
      last_retrieved_at: wireUtc(row.last_retrieved_at),
    })),
  };
}
