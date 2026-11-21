import { sql, type SelectQueryBuilder, type SqlBool } from 'kysely';

import type { Database } from './database.ts';
import type { DB } from '../generated/db-schema.ts';

export type RecordScope = { workspaceId: string; projectId: string | null };

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
