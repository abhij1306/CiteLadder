/**
 * Replay-safe public writes. Every public POST that creates or spends needs an
 * `Idempotency-Key`: the first request claims the key, a retry with the same
 * body receives the stored response, and the same key with another body (or
 * while the first is still running) is 409 `idempotency_conflict`.
 *
 * The claim commits before the work runs. A refused attempt (a coded 4xx)
 * releases it, so a corrected retry runs again; a server failure keeps it, since
 * its write may have committed, so a retry gets a retryable 409 instead of a
 * second write. Only successful responses are stored, for
 * `idempotency.retention_hours` (purged by the runner).
 */
import { createHash, randomUUID } from 'node:crypto';

import type { Context } from 'hono';

import { policy } from '../config.ts';
import type { AppEnv } from '../context.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';

const P = policy.public_api;
const CONFLICT = 'idempotency_conflict';
const REPLAYED_HEADER = 'idempotent-replayed';

export async function withIdempotency(
  db: Database,
  c: Context<AppEnv>,
  run: () => Promise<Response>,
): Promise<Response> {
  const apiKey = c.get('apiKey');
  const key = c.req.header('idempotency-key')?.trim() ?? '';
  if (apiKey === undefined)
    throw new Error('Idempotent public writes run after key authentication');
  if (!key) throw new ApiError(422, 'An Idempotency-Key header is required');
  if (key.length > P.idempotency.key_max_chars)
    throw new ApiError(422, 'Idempotency-Key is too long');
  const requestHash = createHash('sha256')
    .update(`${c.req.method} ${c.req.path}\n`)
    .update(await c.req.text())
    .digest('hex');
  const workspaceId = c.get('workspace').workspaceId;
  const claimed = await db
    .insertInto('api_idempotency')
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      api_key_id: apiKey.id,
      idempotency_key: key,
      request_hash: requestHash,
      status_code: null,
      response_body: null,
      created_at: new Date(),
    })
    .onConflict((conflict) => conflict.constraint('uq_api_idempotency_key').doNothing())
    .returning('id')
    .executeTakeFirst();
  if (claimed === undefined) return replay(db, apiKey.id, key, requestHash);
  const release = () => db.deleteFrom('api_idempotency').where('id', '=', claimed.id).execute();
  let response: Response;
  try {
    response = await run();
  } catch (error) {
    // A coded 4xx is a refusal before any write; anything else may follow a
    // commit, so the claim stays and a retry cannot repeat the write.
    if (error instanceof ApiError && error.status < 500) await release();
    throw error;
  }
  if (response.status < 200 || response.status >= 300) {
    if (response.status < 500) await release();
    return response;
  }
  const text = await response.clone().text();
  await db
    .updateTable('api_idempotency')
    .set({ status_code: response.status, response_body: text || null })
    .where('id', '=', claimed.id)
    .execute();
  return response;
}

async function replay(
  db: Database,
  apiKeyId: string,
  key: string,
  requestHash: string,
): Promise<Response> {
  const prior = await db
    .selectFrom('api_idempotency')
    .select(['request_hash', 'status_code', 'response_body'])
    .where('api_key_id', '=', apiKeyId)
    .where('idempotency_key', '=', key)
    .executeTakeFirst();
  if (prior === undefined)
    throw new ApiError(409, 'The earlier request with this Idempotency-Key just failed; retry', {
      code: CONFLICT,
      retryable: true,
    });
  if (prior.request_hash !== requestHash)
    throw new ApiError(409, 'This Idempotency-Key was used with a different request', {
      code: CONFLICT,
    });
  if (prior.status_code === null)
    throw new ApiError(409, 'A request with this Idempotency-Key is still in progress', {
      code: CONFLICT,
      retryable: true,
    });
  const headers = { [REPLAYED_HEADER]: 'true' };
  if (prior.response_body === null)
    return new Response(null, { status: prior.status_code, headers });
  return Response.json(prior.response_body, { status: prior.status_code, headers });
}

/** Delete a bounded batch of records past retention. */
export function purgeApiIdempotency(
  db: Database,
  now: Date,
  canAdmit: () => boolean = () => true,
): Promise<number> {
  if (!canAdmit()) return Promise.resolve(0);
  const cutoff = new Date(now.getTime() - P.idempotency.retention_hours * 3600 * 1000);
  return db.transaction().execute(async (trx) => {
    const rows = await trx
      .selectFrom('api_idempotency')
      .select('id')
      .where('created_at', '<', cutoff)
      .orderBy('created_at')
      .limit(P.idempotency.purge_batch)
      .forUpdate()
      .skipLocked()
      .execute();
    if (!rows.length) return 0;
    const deleted = await trx
      .deleteFrom('api_idempotency')
      .where(
        'id',
        'in',
        rows.map((row) => row.id),
      )
      .executeTakeFirst();
    return Number(deleted.numDeletedRows);
  });
}
