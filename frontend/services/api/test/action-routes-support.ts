import { sql } from 'kysely';
import { afterAll } from 'vitest';
import {
  actionDeclarationSchema,
  actionDetailSchema,
  actionsPageSchema,
} from '@citeladder/contracts/actions';
import { createApp } from '../src/app.ts';
import { actionFixture, type ActionSeed } from './action-support.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';

export const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
export const nextDay = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
export const boundary = `${day}T15:00:00.123456Z`;
export const pageRule = 'site_link_near_orphan';
export const otherRule = 'site_link_weak_authority';
export const promptRule = 'brand_absent_high_value_prompt';

export const pageBody = async (response: Response) =>
  actionsPageSchema.parse(await response.json());
export const detailBody = async (response: Response) =>
  actionDetailSchema.parse(await response.json());
export const declarationBody = async (response: Response) =>
  actionDeclarationSchema.parse(await response.json());
export const actionId = (s: ActionSeed, rule = pageRule) => s.actions[rule]!;
export const actionPath = (s: ActionSeed, rule = pageRule) =>
  `/api/v1/actions/${actionId(s, rule)}`;

export function actionRoutes() {
  const config = testConfig();
  const db = testDatabase(config);
  const app = createApp(config, db);
  const seeds: ActionSeed[] = [];
  afterAll(async () => {
    if (seeds.length) {
      const workspaceIds = seeds.map((s) => s.workspace_id);
      const userIds = seeds.map((s) => s.user_id);
      await db.deleteFrom('workspaces').where('id', 'in', workspaceIds).execute();
      await db.deleteFrom('users').where('id', 'in', userIds).execute();
    }
    await db.destroy();
  });
  async function seed() {
    const s = await actionFixture<ActionSeed>('seed');
    seeds.push(s);
    return s;
  }
  async function request(
    s: ActionSeed,
    path: string,
    method = 'GET',
    body?: unknown,
    key?: string,
  ) {
    const headers: Record<string, string> = {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: s.user_id, ver: 0 })}`,
      'x-workspace-id': s.workspace_id,
      'content-type': 'application/json',
    };
    if (key !== undefined) headers['Idempotency-Key'] = key;
    return app.request(path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const declare = (s: ActionSeed, key: string, rule = pageRule, extra = {}) =>
    request(
      s,
      `${actionPath(s, rule)}/declaration`,
      'POST',
      { declared_implemented_at: boundary, ...extra },
      key,
    );
  async function eventCount(s: ActionSeed) {
    const row = await db
      .selectFrom('action_status_events')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('workspace_id', '=', s.workspace_id)
      .executeTakeFirstOrThrow();
    return row.n;
  }
  return { app, db, seed, request, declare, eventCount };
}
