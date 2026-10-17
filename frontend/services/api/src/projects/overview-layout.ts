/**
 * The project's Overview layout: which widgets show, in what order and at what
 * width. One row per project, shared by every member; a save names the version
 * it edited, so two editors never silently overwrite each other.
 */
import { randomUUID } from 'node:crypto';

import { asApiErrorCode } from '@citeladder/contracts/error-codes';
import {
  overviewWidgetSchema,
  type OverviewLayout,
  type OverviewWidget,
} from '@citeladder/contracts/overview';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { ApiError, notFound } from '../errors.ts';
import type { ProjectScope } from './brand-profile.ts';

const CONFLICT = asApiErrorCode(policy.projects.CODE_OVERVIEW_LAYOUT_CONFLICT);
const storedWidgets = z.array(overviewWidgetSchema);

function defaultOverviewLayout(): OverviewWidget[] {
  return policy.projects.overview_default_layout.map((widget) => ({ ...widget }));
}

export async function readOverviewLayout(
  db: Database,
  scope: ProjectScope,
): Promise<OverviewLayout> {
  const workspace = new WorkspaceScope(scope.workspaceId);
  const project = await workspace
    .selectFrom(db, 'projects')
    .select('id')
    .where('id', '=', scope.projectId)
    .executeTakeFirst();
  if (!project) throw notFound('Project');
  const row = await workspace
    .selectFrom(db, 'overview_layouts')
    .select(['widgets', 'version', 'updated_at'])
    .where('project_id', '=', scope.projectId)
    .executeTakeFirst();
  const widgets = row?.widgets == null ? null : storedWidgets.parse(row.widgets);
  return {
    widgets: widgets ?? defaultOverviewLayout(),
    version: row?.version ?? 0,
    customized: widgets !== null,
    updated_at: row?.updated_at.toISOString() ?? null,
  };
}

/** `widgets: null` resets to the default layout; it still advances the version. */
export async function updateOverviewLayout(
  db: Database,
  scope: ProjectScope,
  update: { widgets: OverviewWidget[] | null; expectedVersion: number; userId: string },
): Promise<OverviewLayout> {
  const keys = update.widgets?.map((widget) => widget.key) ?? [];
  if (new Set(keys).size !== keys.length)
    throw new ApiError(422, 'each Overview widget can appear once');
  await db.transaction().execute(async (trx) => {
    const workspace = new WorkspaceScope(scope.workspaceId);
    const project = await workspace
      .selectFrom(trx, 'projects')
      .select('id')
      .where('id', '=', scope.projectId)
      .forUpdate()
      .executeTakeFirst();
    if (!project) throw notFound('Project');
    const row = await workspace
      .selectFrom(trx, 'overview_layouts')
      .select(['id', 'version'])
      .where('project_id', '=', scope.projectId)
      .forUpdate()
      .executeTakeFirst();
    const current = row?.version ?? 0;
    if (update.expectedVersion !== current)
      throw new ApiError(
        409,
        `Overview layout version changed from ${update.expectedVersion} to ${current}`,
        { code: CONFLICT },
      );
    const widgets = update.widgets === null ? null : JSON.stringify(update.widgets);
    const now = new Date();
    if (row === undefined)
      await trx
        .insertInto('overview_layouts')
        .values({
          id: randomUUID(),
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          widgets,
          version: 1,
          updated_by_user_id: update.userId,
          created_at: now,
          updated_at: now,
        })
        .execute();
    else
      await trx
        .updateTable('overview_layouts')
        .set({ widgets, version: current + 1, updated_by_user_id: update.userId, updated_at: now })
        .where('id', '=', row.id)
        .execute();
  });
  return readOverviewLayout(db, scope);
}
