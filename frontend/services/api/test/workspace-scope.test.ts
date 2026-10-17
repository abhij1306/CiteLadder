import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveWorkspaceMember, type WorkspaceContext } from '../src/auth/workspace.ts';
import { WorkspaceScope } from '../src/db/workspace-scope.ts';
import { Fixtures, testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new Fixtures(db);
let ours: string;
let theirs: string;

/** Seed a project the way a route would: only with the write capability. */
async function project(workspace: WorkspaceContext, name: string): Promise<string> {
  workspace.require('write');
  const id = randomUUID();
  await db
    .insertInto('projects')
    .values({
      id,
      workspace_id: workspace.workspaceId,
      name,
      brand_name: name,
      website_url: 'https://example.test',
      industry: 'software',
      subindustry: 'analytics',
      primary_market: 'US',
      country_code: 'US',
      language_code: 'en',
      benchmark_mode: 'standard',
      default_repetitions: 1,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .execute();
  return id;
}

beforeAll(async () => {
  const ourOwner = await fixtures.user();
  const theirOwner = await fixtures.user();
  ours = await fixtures.ownedWorkspace(ourOwner);
  theirs = await fixtures.ownedWorkspace(theirOwner);
  await project(await resolveWorkspaceMember(db, ourOwner, ours), 'Ours');
  await project(await resolveWorkspaceMember(db, theirOwner, theirs), 'Theirs');
});

afterAll(async () => {
  await db.deleteFrom('projects').where('workspace_id', 'in', [ours, theirs]).execute();
  await fixtures.cleanup();
  await db.destroy();
});

describe('WorkspaceScope', () => {
  it('reads only the scoped workspace', async () => {
    const rows = await new WorkspaceScope(ours).selectFrom(db, 'projects').select('name').execute();
    expect(rows).toEqual([{ name: 'Ours' }]);
  });
});
