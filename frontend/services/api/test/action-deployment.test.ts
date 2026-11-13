/** The Action's recorded deployment step at the real routes and PostgreSQL. */
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { actionDeclarationSchema, actionDetailSchema } from '@citeladder/contracts/actions';
import { declarationView } from '../src/opportunities/declaration-view.ts';
import { actionFixture, type ActionSeed } from './action-support.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';

const config = testConfig();
const db = testDatabase(config);
const app = createApp(config, db);
const seeds: ActionSeed[] = [];
const goLive = `${new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)}T15:00:00Z`;
const rule = 'missing_structured_data';

async function seed() {
  const s = await actionFixture<ActionSeed>('seed');
  seeds.push(s);
  return s;
}
async function request(s: ActionSeed, path: string, init: { body?: unknown; key?: string } = {}) {
  const headers: Record<string, string> = {
    cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: s.user_id, ver: 0 })}`,
    'x-workspace-id': s.workspace_id,
    'content-type': 'application/json',
  };
  if (init.key) headers['Idempotency-Key'] = init.key;
  return app.request(path, {
    method: init.body === undefined ? 'GET' : 'POST',
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}
const actionPath = (s: ActionSeed) => `/api/v1/actions/${s.actions[rule]!}`;
const email = async (userId: string) =>
  (await db.selectFrom('users').select('email').where('id', '=', userId).executeTakeFirstOrThrow())
    .email;

afterAll(async () => {
  for (const s of seeds) {
    await db.deleteFrom('workspaces').where('id', '=', s.workspace_id).execute();
    await db.deleteFrom('users').where('id', '=', s.user_id).execute();
  }
  await db.destroy();
});

describe('recording a deployment', () => {
  it('stores what shipped it, names the authenticated recorder and keeps it to its workspace', async () => {
    const s = await seed();
    const foreign = await seed();
    const body = {
      declared_implemented_at: goLive,
      deployment_reference: '  https://git.example.test/acme/site/pull/42  ',
      // The recorder is the session's user; a body field naming another is refused.
    };
    expect(
      (
        await request(s, `${actionPath(s)}/declaration`, {
          body: { ...body, deployed_by: foreign.user_id },
          key: 'with-actor',
        })
      ).status,
    ).toBe(422);
    // Another workspace can neither record nor read this Action's deployment.
    expect(
      (await request(foreign, `${actionPath(s)}/declaration`, { body, key: 'foreign' })).status,
    ).toBe(404);

    const created = await request(s, `${actionPath(s)}/declaration`, { body, key: 'deploy-1' });
    expect(created.status).toBe(201);
    const declaration = actionDeclarationSchema.parse(await created.json());
    expect({
      at: declaration.declared_implemented_at,
      by: declaration.deployed_by,
      reference: declaration.deployment_reference,
    }).toEqual({
      at: goLive,
      by: await email(s.user_id),
      reference: 'https://git.example.test/acme/site/pull/42',
    });

    // The same key with another reference is a different request.
    expect(
      (
        await request(s, `${actionPath(s)}/declaration`, {
          body: { ...body, deployment_reference: 'v2.0.0' },
          key: 'deploy-1',
        })
      ).status,
    ).toBe(409);
    // A replay returns the recorded deployment unchanged.
    const replay = await request(s, `${actionPath(s)}/declaration`, { body, key: 'deploy-1' });
    expect(replay.status).toBe(200);
    expect(actionDeclarationSchema.parse(await replay.json()).deployment_reference).toBe(
      'https://git.example.test/acme/site/pull/42',
    );

    const detail = actionDetailSchema.parse(await (await request(s, actionPath(s))).json());
    expect([detail.declaration?.deployed_by, detail.declaration?.deployment_reference]).toEqual([
      await email(s.user_id),
      'https://git.example.test/acme/site/pull/42',
    ]);
    expect((await request(foreign, actionPath(s))).status).toBe(404);

    // A recorder who left the workspace is no longer named.
    await db.deleteFrom('workspace_members').where('workspace_id', '=', s.workspace_id).execute();
    const stored = await db
      .selectFrom('opportunity_implementation_events')
      .selectAll()
      .where('workspace_id', '=', s.workspace_id)
      .executeTakeFirstOrThrow();
    const view = await declarationView(db, stored);
    expect([view.deployed_by, view.deployment_reference]).toEqual([
      null,
      'https://git.example.test/acme/site/pull/42',
    ]);
  });

  it('records no reference when none or a blank one is given and refuses a multi-line or NUL one', async () => {
    const s = await seed();
    for (const reference of ['v1\nv2', 'v1\u0000']) {
      expect(
        (
          await request(s, `${actionPath(s)}/declaration`, {
            body: { declared_implemented_at: goLive, deployment_reference: reference },
            key: `refused-${reference.length}`,
          })
        ).status,
      ).toBe(422);
    }
    const created = await request(s, `${actionPath(s)}/declaration`, {
      body: { declared_implemented_at: goLive, deployment_reference: '   ' },
      key: 'blank',
    });
    expect(created.status).toBe(201);
    expect(actionDeclarationSchema.parse(await created.json()).deployment_reference).toBeNull();
  });
});
