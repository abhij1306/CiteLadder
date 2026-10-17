import type { z } from 'zod';
import { crawlSourceListSchema } from '@citeladder/contracts/ai-traffic';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import type { CrawlScope } from './state.ts';
import type { Selectable } from 'kysely';
import type { CrawlLogSources } from '../generated/db-schema.ts';
import { crawlers } from '../config/crawlers.ts';
import { crawlLogAvailability } from './sources.ts';
import { crawlLogReaderEmail } from './gcp-client.ts';
import { gcpLogFilter } from './gcp-filter.ts';

type Source = Selectable<CrawlLogSources>;
/** The crawler catalog is static per process, so its sink filter is built once. */
const LOG_FILTER = gcpLogFilter();
function connection(status: string, accepted: Date | null | undefined, completed: number) {
  if (status === 'revoked') return 'not_connected';
  return accepted || completed ? 'connected' : 'awaiting_data';
}
function sourceState(s: Source) {
  if (s.status === 'revoked') return 'revoked';
  if (s.stall_reason) return 'stalled';
  return s.kind === 'pull' && !s.verified_at ? 'awaiting_verification' : 'active';
}
const iso = (at: Date | null) => at?.toISOString() ?? null;
/** What a pull source's row shows: verification, filter currency and drains. */
function pullView(s: Source) {
  if (
    s.kind !== 'pull' ||
    s.subscription === null ||
    s.verification_nonce === null ||
    s.filter_catalog_version === null ||
    s.declared_sample_rate === null
  )
    return null;
  return {
    subscription: s.subscription,
    verification_nonce: s.verification_nonce,
    verified_at: iso(s.verified_at),
    verification_checked_at: iso(s.verification_checked_at),
    verification_failure: s.verification_failure,
    filter_catalog_version: s.filter_catalog_version,
    filter_confirmed_at: iso(s.filter_confirmed_at),
    filter_current: s.filter_catalog_version === crawlers.catalog_version,
    // numeric(4,3) arrives as text.
    declared_sample_rate: Number(s.declared_sample_rate),
    last_pull_at: iso(s.last_pull_at),
    last_drained_at: iso(s.last_drained_at),
  };
}
/** Three scoped reads, independent of source count; never refreshes or verifies. */
export async function sourceList(
  db: Database,
  scope: CrawlScope,
): Promise<z.input<typeof crawlSourceListSchema>> {
  const [rows, batches, uploads] = await Promise.all([
    db
      .selectFrom('crawl_log_sources')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .orderBy('created_at', 'desc')
      .execute(),
    db
      .selectFrom('crawl_log_batches')
      .select([
        'source_id',
        sql<Date | null>`max(received_at) filter(where status='accepted')`.as('last'),
        sql<number>`count(*) filter(where status='unsupported_format')::integer`.as('unsupported'),
        sql<number>`coalesce(sum(lines_rejected),0)::integer`.as('rejected'),
        sql<number>`coalesce(sum(lines_overlapping),0)::integer`.as('overlapping'),
      ])
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .groupBy('source_id')
      .execute(),
    db
      .selectFrom('crawl_log_uploads')
      .select([
        'source_id',
        sql<number>`count(*) filter(where status='unsupported_format')::integer`.as('count'),
        sql<number>`count(*) filter(where status='completed')::integer`.as('completed'),
      ])
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .groupBy('source_id')
      .execute(),
  ]);
  const batchBySource = new Map(batches.map((row) => [row.source_id, row]));
  const uploadBySource = new Map(uploads.map((row) => [row.source_id, row]));
  const items = rows.map((s) => {
    const batch = batchBySource.get(s.id);
    const upload = uploadBySource.get(s.id);
    return {
      id: s.id,
      kind: s.kind,
      setup: s.setup,
      preset: s.preset,
      buffer_interval_seconds: s.buffer_interval_seconds,
      format: s.format,
      collection_point: s.collection_point,
      sampling: s.sampling,
      origin: s.origin,
      host: s.host,
      status: s.status,
      state: sourceState(s),
      stall_reason: s.status === 'revoked' ? null : s.stall_reason,
      stalled_at: s.status === 'revoked' ? null : iso(s.stalled_at),
      pull: pullView(s),
      token_prefix: s.token_prefix,
      connection: connection(s.status, batch?.last, upload?.completed ?? 0),
      last_accepted_batch: batch?.last?.toISOString() ?? null,
      last_processed_at: s.last_processed_at?.toISOString() ?? null,
      rejected_lines: batch?.rejected ?? 0,
      overlapping_lines: batch?.overlapping ?? 0,
      unsupported_uploads: upload?.count ?? 0,
      unsupported_batches: batch?.unsupported ?? 0,
    };
  });
  const readerEmail = crawlLogReaderEmail();
  return crawlSourceListSchema.parse({
    availability: crawlLogAvailability(),
    gcp_pull: {
      availability: readerEmail ? 'available' : 'pull_unavailable',
      reader_email: readerEmail || null,
      log_filter: LOG_FILTER,
      catalog_version: crawlers.catalog_version,
    },
    items,
  });
}
