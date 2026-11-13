import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { TEST_SESSION_COOKIE, testConfig, testDatabase, sessionToken } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { auditTenant } from './audit-fixtures.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { createAudits } from '../src/audits/creation.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { auditEvents } from '../src/audits/reads.ts';
import { auditEventTail } from '../src/audits/events.ts';
import { eventFrames } from '../src/http/event-stream.ts';
import { auditEventSchema } from '@citeladder/contracts/audit-events';

const config = testConfig({
  AUDIT_SSE_POLL_SECONDS: '0.001',
  AUDIT_SSE_TERMINAL_GRACE_POLLS: '1',
  AUDIT_MAX_EVENT_PAGE: '2',
});
const db = testDatabase(config),
  fixtures = new VisibilityFixtures(db),
  app = createApp(config, db),
  runtime = auditRuntime({});
afterEach(async () => {
  await fixtures.cleanup();
});
afterAll(async () => {
  await db.destroy();
});
async function seed() {
  const t = await auditTenant(db, fixtures);
  const [auditId] = await createAudits(
    db,
    t.workspaceId,
    auditInput.parse({ project_id: t.projectId, prompt_set_id: t.setId, engines: ['chatgpt'] }),
    {},
    runtime,
  );
  return { ...t, auditId };
}
async function request(
  userId: string,
  workspaceId: string,
  path: string,
  method = 'GET',
  body?: unknown,
  headers = {},
) {
  return app.request(`/api/v1/audits${path}`, {
    method,
    headers: {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: userId, ver: 0 })}`,
      'x-workspace-id': workspaceId,
      'content-type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
describe('audit HTTP family cutover', () => {
  it('permits viewer previews and reads, gates mutations, scopes foreign IDs and serves safe downloads', async () => {
    const t = await seed(),
      foreign = await seed(),
      viewer = await fixtures.user();
    await fixtures.member(t.workspaceId, viewer, 'viewer');
    const body = { project_id: t.projectId, prompt_set_id: t.setId, engines: ['chatgpt'] };
    expect((await request(viewer, t.workspaceId, '/estimate', 'POST', body)).status).toBe(200);
    expect((await request(viewer, t.workspaceId, '', 'POST', body)).status).toBe(403);
    expect((await request(viewer, t.workspaceId, `/${t.auditId}/cancel`, 'POST')).status).toBe(403);
    expect((await request(viewer, t.workspaceId, `/${t.auditId}`)).status).toBe(200);
    expect((await request(t.userId, t.workspaceId, `/${foreign.auditId}`)).status).toBe(404);
    expect((await request(t.userId, t.workspaceId, `/${foreign.auditId}/export.csv`)).status).toBe(
      404,
    );
    const csv = await request(viewer, t.workspaceId, `/${t.auditId}/export.csv`);
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(csv.headers.get('content-disposition')).toBe(
      `attachment; filename="audit-${t.auditId}.csv"`,
    );
    expect((await request(viewer, t.workspaceId, `/${t.auditId}/metrics`)).status).toBe(404);
    // An unrecognized extra field cannot change manual BYOK admission.
    const created = await request(t.userId, t.workspaceId, '', 'POST', {
      ...body,
      repetitions: 1,
      credential_mode: 'unrecognized',
    });
    expect(created.status).toBe(201);
    const [run] = (await created.json()) as [{ id: string }];
    expect((await request(t.userId, t.workspaceId, `/${run.id}/cancel`, 'POST')).status).toBe(200);
    expect((await request(t.userId, t.workspaceId, `/${run.id}/cancel`, 'POST')).status).toBe(409);
  });
  it('leaves an unscored answer empty in the CSV, never False or 0', async () => {
    const t = await auditTenant(db, fixtures);
    const [auditId] = await createAudits(
      db,
      t.workspaceId,
      auditInput.parse({
        project_id: t.projectId,
        prompt_set_id: t.setId,
        engines: ['chatgpt'],
        repetitions: 2,
      }),
      {},
      runtime,
    );
    const [scored, failed] = await db
      .selectFrom('audit_tasks')
      .select('id')
      .where('audit_id', '=', auditId!)
      .orderBy('repetition')
      .execute();
    await db
      .updateTable('audit_tasks')
      .set({
        status: 'succeeded',
        score: JSON.stringify({
          search_query_count: 0,
          brand_mentioned: false,
          owned_domain_cited: false,
          owned_citation_count: 0,
          citation_count: 0,
        }),
      })
      .where('id', '=', scored!.id)
      .execute();
    await db
      .updateTable('audit_tasks')
      .set({ status: 'failed', error_code: 'provider_timeout' })
      .where('id', '=', failed!.id)
      .execute();

    const csv = await request(t.userId, t.workspaceId, `/${auditId}/export.csv`);
    const [header, ...rows] = (await csv.text()).trim().split('\r\n');
    const columns = header!.split(',');
    const cells = (row: string) => {
      // No cell in these rows holds a comma.
      const values = row.split(',');
      return Object.fromEntries(
        [
          'status',
          'search_query_count',
          'brand_mentioned',
          'owned_citation_count',
          'citation_count',
        ].map((name) => [name, values[columns.indexOf(name)]]),
      );
    };
    expect(rows.map(cells)).toEqual([
      {
        status: 'succeeded',
        search_query_count: '0',
        brand_mentioned: 'False',
        owned_citation_count: '0',
        citation_count: '0',
      },
      {
        status: 'failed',
        search_query_count: '',
        brand_mentioned: '',
        owned_citation_count: '',
        citation_count: '',
      },
    ]);
  });
  it('drains terminal stream pages and uses the same validated envelopes and safe resume cursor as JSON', async () => {
    const t = await seed(),
      foreign = await seed();
    await db
      .updateTable('audits')
      .set({ status: 'completed', completed_at: new Date() })
      .where('id', '=', t.auditId)
      .execute();
    const events = await auditEvents(db, t.workspaceId, t.auditId, undefined, 100);
    const response = await request(t.userId, t.workspaceId, `/${t.auditId}/events?stream=true`);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    const frames = (await response.text())
      .trim()
      .split('\n\n')
      .map((frame) => {
        const lines = frame.split('\n');
        const event = auditEventSchema.parse(
          JSON.parse(lines.find((line) => line.startsWith('data: '))!.slice(6)),
        );
        expect(lines).toContain(`id: ${event.id}`);
        expect(lines).toContain(`event: ${event.event_type}`);
        return event;
      });
    expect(frames).toEqual(events);
    const headers = { 'last-event-id': events[0]!.id };
    const json = await request(
      t.userId,
      t.workspaceId,
      `/${t.auditId}/events`,
      'GET',
      undefined,
      headers,
    );
    expect(await json.json()).toEqual(events.slice(1, 3));
    const resumed = await request(
      t.userId,
      t.workspaceId,
      `/${t.auditId}/events?stream=true`,
      'GET',
      undefined,
      headers,
    );
    const resumedText = await resumed.text();
    expect(resumedText).not.toContain(`id: ${events[0]!.id}\n`);
    expect(resumedText).toContain(`id: ${events.at(-1)!.id}\n`);
    const other = await auditEvents(db, foreign.workspaceId, foreign.auditId, undefined, 1);
    for (const suffix of ['', '?stream=true']) {
      expect(
        (
          await request(
            t.userId,
            t.workspaceId,
            `/${t.auditId}/events${suffix}`,
            'GET',
            undefined,
            { 'last-event-id': other[0]!.id },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await request(
            t.userId,
            t.workspaceId,
            `/${t.auditId}/events${suffix}`,
            'GET',
            undefined,
            { 'last-event-id': 'bad' },
          )
        ).status,
      ).toBe(422);
    }
  });
  it('admits at most three open streams per user until one is aborted', async () => {
    const t = await seed(),
      other = await seed();
    const open = async (userId: string, workspaceId: string, auditId: string) => {
      const abort = new AbortController();
      const response = await app.request(`/api/v1/audits/${auditId}/events?stream=true`, {
        headers: {
          cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: userId, ver: 0 })}`,
          'x-workspace-id': workspaceId,
        },
        signal: abort.signal,
      });
      return { response, abort };
    };
    const held = [
      await open(t.userId, t.workspaceId, t.auditId),
      await open(t.userId, t.workspaceId, t.auditId),
      await open(t.userId, t.workspaceId, t.auditId),
    ];
    expect(held.map(({ response }) => response.status)).toEqual([200, 200, 200]);
    const refused = await open(t.userId, t.workspaceId, t.auditId);
    expect(refused.response.status).toBe(429);
    expect(refused.response.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
    const otherUser = await open(other.userId, other.workspaceId, other.auditId);
    expect(otherUser.response.status).toBe(200);
    held[0]!.abort.abort();
    const admitted = await open(t.userId, t.workspaceId, t.auditId);
    expect(admitted.response.status).toBe(200);
    for (const stream of [...held, otherUser, admitted]) stream.abort.abort();
  });

  it('closes an open stream once its caller is removed from the workspace', async () => {
    const t = await seed();
    // A running audit's stream would otherwise stay open for its full duration.
    const recheckingApp = createApp(
      testConfig({ AUDIT_SSE_POLL_SECONDS: '0.05', ABUSE_SSE_ACCESS_RECHECK_SECONDS: '1' }),
      db,
    );
    const abort = new AbortController();
    const response = await recheckingApp.request(`/api/v1/audits/${t.auditId}/events?stream=true`, {
      headers: {
        cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: t.userId, ver: 0 })}`,
        'x-workspace-id': t.workspaceId,
      },
      signal: abort.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toMatch(/^id: [0-9a-f-]{36}\nevent: /u);
    await db
      .deleteFrom('workspace_members')
      .where('workspace_id', '=', t.workspaceId)
      .where('user_id', '=', t.userId)
      .execute();
    const started = Date.now();
    let next = await reader.read();
    while (!next.done) next = await reader.read();
    expect(Date.now() - started).toBeLessThan(3000);
    abort.abort();
  });

  it('stops a stream on cancellation without polling or retaining a transaction', async () => {
    const t = await seed(),
      signal = new AbortController();
    const frames = eventFrames(
      auditEventTail(
        db,
        { workspaceId: t.workspaceId, auditId: t.auditId, after: undefined },
        runtime,
      ),
      signal.signal,
    );
    expect((await frames.next()).done).toBe(false);
    signal.abort();
    expect((await frames.next()).done).toBe(true);
  });

  it('ends a running audit stream at its maximum duration', async () => {
    const t = await seed();
    // A poll interval longer than the stream may live: the wait itself must stop at the deadline.
    const bounded = auditRuntime({
      AUDIT_SSE_MAX_DURATION_SECONDS: '1',
      AUDIT_SSE_POLL_SECONDS: '5',
    });
    const frames = eventFrames(
      auditEventTail(
        db,
        { workspaceId: t.workspaceId, auditId: t.auditId, after: undefined },
        bounded,
      ),
      new AbortController().signal,
    );
    const started = Date.now();
    let count = 0;
    for await (const _frame of frames) count++;
    expect(count).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(2500);
  });
});
