import type { Database } from '../db/database.ts';
import { mcpPolicy } from './config.ts';

type Table = 'mcp_confirmations' | 'mcp_oauth_grants';

/**
 * Bound protocol storage. Expired unconsumed change confirmations go at once;
 * consumed ones and ended token grants are kept for the retention period as
 * audit evidence, then go too.
 */
export async function cleanupMcpProtocol(db: Database, now = new Date(), canAdmit = () => true) {
  const retained = new Date(now.getTime() - mcpPolicy.protocol_retention_seconds * 1000);
  let deleted = 0;
  for (const table of ['mcp_confirmations', 'mcp_oauth_grants'] as const)
    deleted += await cleanup(db, table, now, retained, canAdmit);
  return deleted;
}

async function cleanup(
  db: Database,
  table: Table,
  now: Date,
  retained: Date,
  canAdmit: () => boolean,
) {
  if (!canAdmit()) return 0;
  return await db.transaction().execute(async (trx) => {
    const rows =
      table === 'mcp_oauth_grants'
        ? await trx
            .selectFrom(table)
            .select('id')
            .where((eb) =>
              eb.or([eb('refresh_expires_at', '<=', retained), eb('revoked_at', '<=', retained)]),
            )
            .limit(mcpPolicy.protocol_cleanup_batch)
            .forUpdate()
            .skipLocked()
            .execute()
        : await trx
            .selectFrom(table)
            .select('id')
            .where((eb) =>
              eb.or([
                eb.and([eb('expires_at', '<=', now), eb('consumed_at', 'is', null)]),
                eb('expires_at', '<=', retained),
              ]),
            )
            .orderBy('expires_at')
            .limit(mcpPolicy.protocol_cleanup_batch)
            .forUpdate()
            .skipLocked()
            .execute();
    if (!rows.length) return 0;
    const result = await trx
      .deleteFrom(table)
      .where(
        'id',
        'in',
        rows.map((row) => row.id),
      )
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  });
}
