import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import type { Actor } from '../src/auth/actor.ts';
import { changeKinds } from '../src/changes/kinds.ts';
import { AGENT_CHANGE_KINDS, type AgentChangeKind } from '../src/agent/change-proposals.ts';
import { ApiError } from '../src/errors.ts';
import { IMPORT_KINDS, kindCases, type KindScope, type TabledKind } from './change-kind-cases.ts';
import { SiteFixtures } from './site-health-fixtures.ts';
import { testConfig, testDatabase } from './support.ts';

const config = testConfig();
const db = testDatabase(config);
const fixtures = new SiteFixtures(db);
const table = kindCases(db, fixtures);

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const actorOf = (scope: KindScope, role = 'owner'): Actor => ({
  kind: 'member',
  workspaceId: scope.workspaceId,
  userId: scope.userId,
  role,
  scopes: 'all',
});

function stage(kind: AgentChangeKind, scope: KindScope, payload: unknown, role?: string) {
  const context = { db, config, workspaceId: scope.workspaceId, projectId: scope.projectId };
  const change = { id: randomUUID(), projectId: scope.projectId };
  return changeKinds[kind].stage(context, actorOf(scope, role), change, payload);
}

async function status(promise: Promise<unknown>) {
  try {
    await promise;
    return 200;
  } catch (error) {
    if (error instanceof ApiError) return error.status;
    throw error;
  }
}

const ATTACHMENT_KINDS_TESTED_IN_IMPORT_PROPOSALS: readonly AgentChangeKind[] = IMPORT_KINDS;
const TABLED = AGENT_CHANGE_KINDS.filter(
  (kind): kind is TabledKind => !ATTACHMENT_KINDS_TESTED_IN_IMPORT_PROPOSALS.includes(kind),
);

it.each(TABLED)(
  '%s previews without a trace, refuses a viewer and another workspace’s record, and executes through its owner',
  async (kind) => {
    const row = table[kind];
    const arranged = await row.arrange();
    expect(await arranged.observe()).toEqual(arranged.before);

    const staged = await stage(kind, arranged.scope, arranged.payload);
    expect(await arranged.observe()).toEqual(arranged.before);
    expect(await status(stage(kind, arranged.scope, arranged.payload, 'viewer'))).toBe(403);

    if (row.foreign !== 'none') {
      const other = await row.arrange();
      expect(await status(stage(kind, arranged.scope, other.payload))).toBe(row.foreign);
      expect(await other.observe()).toEqual(other.before);
    }
    if (row.live) return;

    const entry = changeKinds[kind];
    const change = { id: randomUUID(), projectId: arranged.scope.projectId };
    await db
      .transaction()
      .execute((trx) =>
        entry.confirm(trx, config, actorOf(arranged.scope), change, staged.payload),
      );
    expect(await arranged.observe()).toEqual(arranged.after);
  },
);
