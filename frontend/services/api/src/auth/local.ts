/**
 * The single local account of a self-hosted install: one user who owns one
 * workspace. There is no sign-in; every browser request acts as this user.
 */
import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.ts';
import { subjectXactLock } from '../db/advisory-lock.ts';

export const LOCAL_USER_EMAIL = 'local@citeladder.local';
const LOCAL_WORKSPACE_NAME = 'Local workspace';

/** Create the local user and its owned workspace if absent; idempotent. */
export async function ensureLocalAccount(db: Database) {
  return db.transaction().execute(async (trx) => {
    await subjectXactLock(trx, `identity.bootstrap:${LOCAL_USER_EMAIL}`);
    const now = new Date();
    let user = await trx
      .selectFrom('users')
      .selectAll()
      .where('email', '=', LOCAL_USER_EMAIL)
      .executeTakeFirst();
    user ??= await trx
      .insertInto('users')
      .values({
        id: randomUUID(),
        email: LOCAL_USER_EMAIL,
        hashed_password: null,
        role: 'admin',
        is_active: true,
        registration_origin: 'operator',
        email_verified_at: now,
        session_version: 0,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    let workspace = await trx
      .selectFrom('workspace_members')
      .select('workspace_id')
      .where('user_id', '=', user.id)
      .where('role', '=', 'owner')
      .executeTakeFirst();
    if (!workspace) {
      const workspaceId = randomUUID();
      await trx
        .insertInto('workspaces')
        .values({ id: workspaceId, name: LOCAL_WORKSPACE_NAME, created_at: now, updated_at: now })
        .execute();
      await trx
        .insertInto('workspace_members')
        .values({
          id: randomUUID(),
          workspace_id: workspaceId,
          user_id: user.id,
          role: 'owner',
          created_at: now,
          updated_at: now,
        })
        .execute();
      workspace = { workspace_id: workspaceId };
    }
    return { userId: user.id, workspaceId: workspace.workspace_id };
  });
}

let cached: Promise<{ userId: string; workspaceId: string }> | null = null;

/** The local account, created on first use and cached for the process. */
export function localAccount(db: Database) {
  cached ??= ensureLocalAccount(db).catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}
