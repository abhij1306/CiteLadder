import { randomUUID } from 'node:crypto';

import { objectionGroupRequestSchema } from '@citeladder/contracts/probes';
import type { Insertable } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import { inTransaction, type Database } from '../db/database.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { ApiError, notFound } from '../errors.ts';
import type { ProbeAnswerItems } from '../generated/db-schema.ts';
import type { ProjectScope as Scope } from '../projects/brand-profile.ts';
import { idsByName, nameSchema } from '../projects/themes.ts';

export const groupRequest = objectionGroupRequestSchema.extend({
  name: nameSchema(policy.probes.group_name_max_chars),
});

export function listGroups(db: Database, scope: Scope) {
  return db
    .selectFrom('probe_objection_groups')
    .select(['id', 'name'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
}

export async function saveGroups(db: Database, scope: Scope, names: readonly string[], at: Date) {
  if (names.length)
    await db
      .insertInto('probe_objection_groups')
      .values(
        names.map((name) => ({
          id: randomUUID(),
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          name,
          created_at: at,
          updated_at: at,
        })),
      )
      .onConflict((conflict) => conflict.doNothing())
      .execute();
  return idsByName(await listGroups(db, scope));
}

export async function saveAnswerItems(db: Database, rows: Insertable<ProbeAnswerItems>[]) {
  if (rows.length) await db.insertInto('probe_answer_items').values(rows).execute();
}

export async function renameGroup(
  db: Database,
  scope: Scope & { groupId: string },
  input: z.output<typeof groupRequest>,
) {
  try {
    const row = await db
      .updateTable('probe_objection_groups')
      .set({ name: input.name, updated_at: new Date() })
      .where('id', '=', scope.groupId)
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .returning(['id', 'name'])
      .executeTakeFirst();
    if (!row) throw notFound('Objection group');
    return row;
  } catch (error) {
    if (isUniqueViolation(error, 'uq_probe_objection_group_name'))
      throw new ApiError(409, 'An objection group with this name already exists');
    throw error;
  }
}

export function mergeGroups(db: Database, scope: Scope & { groupId: string; intoId: string }) {
  if (scope.groupId === scope.intoId) throw new ApiError(400, 'Choose another group to merge into');
  return inTransaction(db, async (trx) => {
    const groups = await trx
      .selectFrom('probe_objection_groups')
      .select(['id', 'name'])
      .where('id', 'in', [scope.groupId, scope.intoId])
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .orderBy('id')
      .forUpdate()
      .execute();
    const kept = groups.find((group) => group.id === scope.intoId);
    if (groups.length !== 2 || !kept) throw notFound('Objection group');
    await trx
      .updateTable('probe_answer_items')
      .set({ objection_group_id: scope.intoId })
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('objection_group_id', '=', scope.groupId)
      .execute();
    await trx
      .deleteFrom('probe_objection_groups')
      .where('id', '=', scope.groupId)
      .where('workspace_id', '=', scope.workspaceId)
      .execute();
    return kept;
  });
}

export async function deleteGroup(db: Database, scope: Scope & { groupId: string }) {
  const result = await db
    .deleteFrom('probe_objection_groups')
    .where('id', '=', scope.groupId)
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .executeTakeFirst();
  if (!result.numDeletedRows) throw notFound('Objection group');
}
