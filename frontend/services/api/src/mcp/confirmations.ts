import type { Actor } from '../auth/actor.ts';
import { recordSecurityEvent } from '../auth/security-events.ts';
import type { ServiceConfig } from '../config.ts';
import { base62, base62Length, fingerprint } from '../crypto-text.ts';
import type { Database } from '../db/database.ts';
import { mcpPolicy } from './config.ts';
import {
  isConfirmedKind,
  preparedChanges,
  type ConfirmedKind,
  type PreparedChange,
} from './confirmed-changes.ts';
import { writeActor } from './data.ts';
import { tokenHash } from './token-auth.ts';
import { McpInputError, type McpPrincipal } from './types.ts';

const tokenHmac = (config: ServiceConfig, token: string) =>
  tokenHash(config, `mcp-confirmation:${token}`);

export async function issueConfirmation(
  db: Database,
  config: ServiceConfig,
  input: Readonly<{
    change: PreparedChange;
    principal: McpPrincipal;
    actor: Actor;
    kind: ConfirmedKind;
    payload: Record<string, unknown>;
  }>,
) {
  const token = base62(base62Length(256));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + mcpPolicy.confirmation_ttl_seconds * 1000);
  await db
    .insertInto('mcp_confirmations')
    .values({
      id: input.change.id,
      workspace_id: input.actor.workspaceId,
      grant_id: input.principal.grantId,
      user_id: input.principal.userId,
      kind: input.kind,
      project_id: input.change.projectId,
      payload: JSON.stringify(input.payload),
      payload_hash: fingerprint(input.payload),
      token_hmac: tokenHmac(config, token),
      expires_at: expiresAt,
      consumed_at: null,
      created_at: now,
    })
    .execute();
  return { confirmation_token: token, expires_at: expiresAt.toISOString() };
}

export function confirmChange(
  db: Database,
  config: ServiceConfig,
  principal: McpPrincipal,
  token: string,
) {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('mcp_confirmations')
      .selectAll()
      .where('token_hmac', '=', tokenHmac(config, token))
      .forUpdate()
      .executeTakeFirst();
    if (row?.grant_id !== principal.grantId)
      throw new McpInputError(
        'This confirmation token is not valid for this connection. Prepare the change again.',
      );
    if (row.consumed_at) throw new McpInputError('This change was already confirmed.');
    if (row.expires_at.getTime() <= Date.now())
      throw new McpInputError(
        'This confirmation expired. Prepare the change again and confirm it within ten minutes.',
      );
    if (fingerprint(row.payload) !== row.payload_hash)
      throw new Error('A stored MCP confirmation payload changed');
    const kind = row.kind;
    if (!isConfirmedKind(kind)) throw new Error(`A stored MCP confirmation has no kind ${kind}`);
    const actor = await writeActor(trx, principal, row.project_id);
    const change = { id: row.id, projectId: row.project_id };
    const result = await preparedChanges[kind].confirm(trx, config, actor, change, row.payload);
    await trx
      .updateTable('mcp_confirmations')
      .set({ consumed_at: new Date() })
      .where('id', '=', row.id)
      .execute();
    await recordSecurityEvent(
      trx,
      `mcp.write.${kind}`,
      principal.userId,
      row.workspace_id,
      row.project_id,
    );
    return { kind, result };
  });
}
