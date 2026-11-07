/**
 * Persisted AI referral classifications, the one source every referral
 * breakdown reads (OD3): the headline, the landing and source breakdowns and
 * Performance agree until a reclassification writes new rows. Nothing here
 * classifies live.
 */
import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { isoDateText } from '../db/timestamps.ts';
import { selectedPartition, type PartitionScope } from '../integrations/partitions.ts';
import { isNonEmpty, lastOf, type NonEmpty } from '../lists.ts';

const SOURCE_MEDIUM = policy.referrals.datasets.source_medium_daily;
const BATCH_SIZE = 500;
const arities: Record<string, number> = Object.fromEntries(
  Object.entries(policy.integrations.datasets).map(([name, dataset]) => [
    name,
    dataset.dimensions.length,
  ]),
);

/** A GA4 row's dimension values; the first absorbs separators inside it (a landing path). */
export function dimensionParts(dataset: string, dimensionKey: string): NonEmpty<string> {
  const split = dimensionKey.split(policy.integrations.dimension_separator);
  const arity = arities[dataset];
  if (arity === undefined) throw new Error(`Unknown integration dataset: ${dataset}`);
  return [
    split.slice(0, split.length - arity + 1).join(policy.integrations.dimension_separator),
    ...split.slice(split.length - arity + 1),
  ];
}

/** A classified GA4 source/medium metric row. */
export type ClassifiedRow = {
  property_ref: string;
  date: string;
  dimension_key: string;
  is_ai_referral: boolean;
  ai_source: string;
};

const key = (propertyRef: string, day: string, source: string, medium: string) =>
  JSON.stringify([propertyRef, day, source, medium]);

/** Sessions' AI source by property, day, source and medium, from that day's classified source/medium row. */
export class ReferralClassifications {
  private readonly sources = new Map<string, string | null>();

  constructor(rows: Iterable<ClassifiedRow>) {
    for (const row of rows) {
      const [source, medium = ''] = dimensionParts(SOURCE_MEDIUM, row.dimension_key);
      this.sources.set(
        key(row.property_ref, row.date, source, medium),
        row.is_ai_referral ? row.ai_source : null,
      );
    }
  }

  /** The persisted AI source, or null when the pair is not an AI referral or is not yet classified. */
  aiSource(propertyRef: string, day: string, source: string, medium: string): string | null {
    return this.sources.get(key(propertyRef, day, source, medium)) ?? null;
  }
}

/** The persisted classifications of the scope's selected GA4 source/medium rows. */
export async function readReferralClassifications(
  db: Database,
  scope: PartitionScope,
): Promise<ReferralClassifications> {
  const rows: ClassifiedRow[] = [];
  let after: string | null = null;
  for (;;) {
    let query = db
      .selectFrom('integration_metric_rows as row')
      .innerJoin('referral_events as event', (join) =>
        join
          .onRef('event.source_metric_row_id', '=', 'row.id')
          .on('event.workspace_id', '=', scope.workspaceId)
          .on('event.project_id', '=', scope.projectId),
      )
      .innerJoin('referral_classifications as classification', (join) =>
        join
          .onRef('classification.referral_event_id', '=', 'event.id')
          .on('classification.workspace_id', '=', scope.workspaceId)
          .on('classification.project_id', '=', scope.projectId),
      )
      .select([
        'row.id',
        'row.property_ref',
        'row.dimension_key',
        isoDateText(sql.ref('row.date')).as('date'),
        'classification.is_ai_referral',
        'classification.ai_source',
      ])
      .where('row.workspace_id', '=', scope.workspaceId)
      .where('row.project_id', '=', scope.projectId)
      .where('row.dataset', '=', SOURCE_MEDIUM)
      .where('row.date', '>=', sql<Date>`${scope.start}::date`)
      .where('row.date', '<=', sql<Date>`${scope.end}::date`)
      .where(selectedPartition('row'))
      .orderBy('row.id')
      .limit(BATCH_SIZE);
    if (after !== null) query = query.where('row.id', '>', after);
    const batch = await query.execute(); // NOSONAR -- Keyset pages read in order.
    rows.push(...batch);
    if (batch.length < BATCH_SIZE || !isNonEmpty(batch)) break;
    after = lastOf(batch).id;
  }
  return new ReferralClassifications(rows);
}
