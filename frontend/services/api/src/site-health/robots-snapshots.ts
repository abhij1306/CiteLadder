import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '../db/database.ts';
import type { Crawl } from './task-fence.ts';

/** Append evidence without updating a previous body; the crawl records each observation. */
export async function insertRobotsSnapshot(
  db: Database,
  crawl: Pick<Crawl, 'workspace_id' | 'project_id'>,
  origin: string,
  body: string,
  statusCode: number | null,
  maxBytes: number,
) {
  const bytes = Buffer.from(body, 'utf8');
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const retained = new TextDecoder().decode(bytes.subarray(0, maxBytes), {
    stream: bytes.length > maxBytes,
  });
  const inserted = await db
    .insertInto('robots_snapshots')
    .values({
      id: randomUUID(),
      workspace_id: crawl.workspace_id,
      project_id: crawl.project_id,
      origin,
      content_hash: contentHash,
      body: retained,
      truncated: bytes.length > maxBytes,
      status_code: statusCode,
    })
    .onConflict((conflict) =>
      conflict.columns(['workspace_id', 'project_id', 'origin', 'content_hash']).doNothing(),
    )
    .returning('id')
    .executeTakeFirst();
  return (
    inserted ??
    db
      .selectFrom('robots_snapshots')
      .select('id')
      .where('workspace_id', '=', crawl.workspace_id)
      .where('project_id', '=', crawl.project_id)
      .where('origin', '=', origin)
      .where('content_hash', '=', contentHash)
      .executeTakeFirstOrThrow()
  );
}
