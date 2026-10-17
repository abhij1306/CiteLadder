/**
 * Which roster judged a persisted source-page reading, and the passages it
 * quoted.
 *
 * Inspection stamps `roster_version` on every presence: the names, aliases and
 * mention rules it matched with, and the detector version. A reading counts
 * only against the roster in force now.
 */
import { createHash } from 'node:crypto';
import { sql } from 'kysely';

import { policy } from '../config.ts';
import { compareIdentityText } from '../analysis/comparison.ts';
import { storedEntityMatching } from '../analysis/entity-matching.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { scalarText } from '../text-order.ts';
import { wireUtc, utcText } from '../db/timestamps.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';

const sorted = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).sort(compareIdentityText) : [];

/** A stable fingerprint of the brand, competitors and mention rules an audit measured. */
export function projectRoster(configuration: unknown): string {
  const config = record(configuration);
  const competitors = (Array.isArray(config.competitors) ? config.competitors : [])
    .map((item) => {
      const competitor = record(item);
      return [scalarText(competitor.name || ''), ...sorted(competitor.aliases)];
    })
    .sort((a, b) => compareIdentityText(JSON.stringify(a), JSON.stringify(b)));
  const matching = storedEntityMatching(config);
  const identity = {
    brand: scalarText(config.brand_name || ''),
    brand_aliases: sorted(config.brand_aliases),
    competitors,
    matching: Object.keys(matching)
      .sort(compareIdentityText)
      .map((key) => [key, matching[key]]),
    detector: policy.opportunity.source_pages.SOURCE_PAGE_PRESENCE_VERSION,
  };
  const digest = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return `roster-${digest.slice(0, 32)}`;
}

/** The quoted windows behind one verdict, resolved from its snapshot. */
function passageTexts(passages: unknown, refs: unknown): string[] {
  const rows = Array.isArray(passages) ? passages : [];
  const indexes = Array.isArray(refs) ? refs : [];
  return indexes.flatMap((index) => {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return [];
    const text = record(rows[index]).text;
    return typeof text === 'string' && text.trim() ? [text.trim()] : [];
  });
}

type Scope = { workspaceId: string; projectId: string };
export type Reading = {
  id: string;
  source_page_id: string;
  fetched_text: string;
  extracted_chars: number;
  page_facts: unknown;
  evidence_passages: unknown;
};
export type ReadingPresence = {
  snapshot_id: string;
  entity_kind: string;
  entity_name: string;
  presence: string;
  match_method: string;
  match_count: number;
  roster_version: string;
  passage_refs: unknown;
};

/**
 * The latest SUCCESSFUL reading of each page. `source_pages.latest_snapshot_id`
 * is the latest attempt, so a failed read would hide what was learned.
 */
export async function latestReadings(db: Database, scope: Scope, pageIds: string[]) {
  const latest = new Map<string, Reading>();
  if (!pageIds.length) return latest;
  const rows = await sql<Reading>`
    select distinct on (source_page_id)
      id, source_page_id, ${utcText(sql.ref('fetched_at'))} as fetched_text,
      extracted_chars, page_facts, evidence_passages
    from source_page_snapshots
    where workspace_id = ${scope.workspaceId}
      and project_id = ${scope.projectId}
      and source_page_id in (${sql.join(pageIds)})
      and outcome = ${policy.opportunity.refresh.source_page_outcome_inspected}
    order by source_page_id asc, fetched_at desc, id desc
  `.execute(db);
  for (const row of rows.rows) latest.set(row.source_page_id, row);
  return latest;
}

/** The verdicts each reading recorded, brand first, by snapshot. */
export async function readingPresences(db: Database, scope: Scope, snapshotIds: string[]) {
  const grouped = new Map<string, ReadingPresence[]>();
  if (!snapshotIds.length) return grouped;
  const rows = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'source_page_entity_presences')
    .select([
      'snapshot_id',
      'entity_kind',
      'entity_name',
      'presence',
      'match_method',
      'match_count',
      'roster_version',
      'passage_refs',
    ])
    .where('project_id', '=', scope.projectId)
    .where('snapshot_id', 'in', snapshotIds)
    .orderBy(sql`entity_kind <> ${policy.opportunity.source_pages.ENTITY_KIND_BRAND}`)
    .orderBy('entity_name')
    .execute();
  for (const row of rows)
    grouped.set(row.snapshot_id, [...(grouped.get(row.snapshot_id) ?? []), row]);
  return grouped;
}

/** One reading's verdicts with the quoted windows behind each. */
export const pageEntities = (reading: Reading, rows: ReadingPresence[]) =>
  rows.map((row) => ({
    entity_kind: row.entity_kind,
    entity_name: row.entity_name,
    presence: row.presence,
    match_method: row.match_method,
    match_count: row.match_count,
    passages: passageTexts(reading.evidence_passages, row.passage_refs),
  }));

/** When a reading was taken, as the API renders a timestamp. */
export const readAt = (reading: Reading) => wireUtc(reading.fetched_text);
