/**
 * Workspace-scoped reads (invariant: every project-owned read and write is
 * workspace-authorized).
 *
 * A `WorkspaceScope` exists only after membership was verified (see
 * `auth/workspace.ts`), and product tables are reached through it so the
 * `workspace_id` predicate cannot be forgotten. Only tables that carry a
 * `workspace_id` column are accepted, which the compiler enforces.
 *
 * Deliberately read-only: a generic write entry point would also admit the
 * append-only evidence and attempt tables. Writes arrive with the route family
 * that owns them, scoped to that owner's tables.
 */
import { sql, type SelectQueryBuilder, type SqlBool } from 'kysely';

import type { Database } from './database.ts';
import type { DB } from '../generated/db-schema.ts';

export type WorkspaceTable = {
  [Table in keyof DB]: 'workspace_id' extends keyof DB[Table] ? Table : never;
}[keyof DB];

export class WorkspaceScope {
  readonly workspaceId: string;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  // Kysely cannot resolve its builder overloads for a generic table name, so
  // the query widens to the table union once and narrows back.
  selectFrom<Table extends WorkspaceTable>(db: Database, table: Table) {
    const column = sql.ref(table + '.workspace_id');
    const query = db
      .selectFrom(table as WorkspaceTable)
      .where(sql<SqlBool>`${column} = ${this.workspaceId}`);
    return query as unknown as SelectQueryBuilder<DB, Table, Record<never, never>>;
  }
}
