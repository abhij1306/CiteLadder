/**
 * Tenancy in the schema: a project-owned row names its workspace, and
 * PostgreSQL refuses a row whose project (or prompt set) belongs to another.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { promptSet } from './prompt-fixtures.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

/** The SQLSTATE PostgreSQL answers, or 'stored' when the insert succeeded. */
async function outcome(insert: () => Promise<unknown>) {
  try {
    await insert();
    return 'stored';
  } catch (error) {
    return error instanceof Error && 'code' in error ? error.code : 'unknown';
  }
}

describe('workspace-bound project rows', () => {
  it('stores a row in its own workspace and refuses one naming another workspace', async () => {
    const own = await fixtures.tenant(),
      other = await fixtures.tenant();
    const now = new Date();
    const competitor = (workspaceId: string) => () =>
      db
        .insertInto('competitors')
        .values({
          id: randomUUID(),
          workspace_id: workspaceId,
          project_id: own.projectId,
          name: 'Rival',
          aliases: '[]',
          domains: '[]',
          created_at: now,
          updated_at: now,
        })
        .execute();
    // A table that already carried workspace_id beside a project-only key.
    const layout = (workspaceId: string) => () =>
      db
        .insertInto('overview_layouts')
        .values({
          id: randomUUID(),
          workspace_id: workspaceId,
          project_id: own.projectId,
          widgets: null,
          version: 1,
          updated_by_user_id: own.userId,
          created_at: now,
          updated_at: now,
        })
        .execute();
    const setId = await promptSet(db, own.projectId);
    const prompt = (workspaceId: string) => () =>
      db
        .insertInto('prompts')
        .values({
          id: randomUUID(),
          workspace_id: workspaceId,
          prompt_set_id: setId,
          text: `best crm ${randomUUID()}`,
          normalized_text_hash: randomUUID(),
          theme: '',
          intent: '',
          cohort: 'core',
          branded: false,
          enabled: true,
          status: 'active',
          origin: 'manual',
          created_at: now,
          updated_at: now,
        })
        .execute();
    expect([
      await outcome(competitor(own.workspaceId)),
      await outcome(competitor(other.workspaceId)),
      // One layout per project: the refused row goes first.
      await outcome(layout(other.workspaceId)),
      await outcome(layout(own.workspaceId)),
      await outcome(prompt(own.workspaceId)),
      await outcome(prompt(other.workspaceId)),
    ]).toEqual(['stored', '23503', '23503', 'stored', 'stored', '23503']);
  });
});
