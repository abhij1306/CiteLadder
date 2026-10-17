import type { Database } from '../db/database.ts';
import { subjectXactLock } from '../db/advisory-lock.ts';
import { parseUuid } from '../http/uuid.ts';

/** Operator commands act as an active admin user, by id or email. Held until commit. */
export async function requireAdmin(db: Database, email: string) {
  await subjectXactLock(db, 'operator.identity.administration');
  const identity = parseUuid(email);
  const actor = await db
    .selectFrom('users')
    .selectAll()
    .where(identity ? 'id' : 'email', '=', identity ?? email.trim().toLowerCase())
    .where('is_active', '=', true)
    .where('role', '=', 'admin')
    .forUpdate()
    .executeTakeFirst();
  if (!actor) throw new Error('An active admin user is required');
  return actor;
}
