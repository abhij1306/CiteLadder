import { sql, type Selectable } from 'kysely';
import type { z } from 'zod';
import type { crawlStallReasonSchema } from '@citeladder/contracts/ai-traffic';
import type { Database } from '../db/database.ts';
import type { CrawlLogSources } from '../generated/db-schema.ts';
import { crawlLogs } from '../config/crawl-logs.ts';

/**
 * Why a live source stopped delivering. An accepted receipt clears any reason
 * in the transaction that stores it, except one only a passing check lifts.
 */
export type StallReason = z.infer<typeof crawlStallReasonSchema>;
/** Reasons a receipt cannot disprove: a failed subscription check holds until a check passes. */
export const CHECK_HELD_STALLS: readonly string[] = [
  'verification_failed',
] satisfies readonly StallReason[];

/** Record a refusal the sender cannot see in a receipt; the first reason and time stay. */
export async function markStalled(
  db: Database,
  source: Pick<Selectable<CrawlLogSources>, 'workspace_id' | 'project_id' | 'id'>,
  reason: StallReason,
  now = new Date(),
) {
  await db
    .updateTable('crawl_log_sources')
    .set({ stall_reason: reason, stalled_at: now })
    .where('workspace_id', '=', source.workspace_id)
    .where('project_id', '=', source.project_id)
    .where('id', '=', source.id)
    .where('status', '=', 'active')
    .where('stall_reason', 'is', null)
    .execute();
}

export async function clearStall(
  trx: Database,
  source: Pick<Selectable<CrawlLogSources>, 'workspace_id' | 'project_id' | 'id'>,
) {
  await trx
    .updateTable('crawl_log_sources')
    .set({ stall_reason: null, stalled_at: null })
    .where('workspace_id', '=', source.workspace_id)
    .where('project_id', '=', source.project_id)
    .where('id', '=', source.id)
    .where('stall_reason', 'is not', null)
    .where('stall_reason', 'not in', CHECK_HELD_STALLS)
    .execute();
}

/**
 * A workspace's live webhook and verified pull sources older than `stalled_after_hours` with no
 * accepted receipt inside that window become `no_receipts`. Bounded per call.
 */
export async function stallQuietSources(db: Database, workspaceId: string, now = new Date()) {
  const since = new Date(now.getTime() - crawlLogs.stalled_after_hours * 3600000);
  await db
    .updateTable('crawl_log_sources')
    .set({ stall_reason: 'no_receipts', stalled_at: now })
    .where('workspace_id', '=', workspaceId)
    .where(
      'id',
      'in',
      db
        .selectFrom('crawl_log_sources as s')
        .select('s.id')
        .where('s.workspace_id', '=', workspaceId)
        // A pull source is quiet only once it was verified; before that it never pulls.
        .where((eb) =>
          eb.or([
            eb('s.kind', '=', 'webhook'),
            eb.and([eb('s.kind', '=', 'pull'), eb('s.verified_at', 'is not', null)]),
          ]),
        )
        .where('s.status', '=', 'active')
        .where('s.stall_reason', 'is', null)
        .where('s.created_at', '<', since)
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom('crawl_log_batches as b')
                .select(sql`1`.as('one'))
                .whereRef('b.workspace_id', '=', 's.workspace_id')
                .whereRef('b.project_id', '=', 's.project_id')
                .whereRef('b.source_id', '=', 's.id')
                .where('b.status', '=', 'accepted')
                .where('b.received_at', '>=', since),
            ),
          ),
        )
        .limit(crawlLogs.sweep_batch_size),
    )
    .execute();
}
