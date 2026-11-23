import type { Database } from '../db/database.ts';
import { mcpPolicy } from './config.ts';

/**
 * Bound protocol storage. Ended token grants are kept for the retention
 * period as audit evidence, then go.
 */
export async function cleanupMcpProtocol(db: Database, now = new Date(), canAdmit = () => true) {
  if (!canAdmit()) return 0;
  const retained = new Date(now.getTime() - mcpPolicy.protocol_retention_seconds * 1000);
  return await db.transaction().execute(async (trx) => {
    const rows = await trx
      .selectFrom('mcp_oauth_grants')
      .select('id')
      .where((eb) =>
        eb.or([eb('refresh_expires_at', '<=', retained), eb('revoked_at', '<=', retained)]),
      )
      .limit(mcpPolicy.protocol_cleanup_batch)
      .forUpdate()
      .skipLocked()
      .execute();
    if (!rows.length) return 0;
    const result = await trx
      .deleteFrom('mcp_oauth_grants')
      .where(
        'id',
        'in',
        rows.map((row) => row.id),
      )
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  });
}
