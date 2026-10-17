import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { policy } from '../src/config.ts';
import { record } from '../src/db/json.ts';
import {
  internalLinkJudge,
  compensateInternalLinks,
} from '../src/site-health/internal-link-judgments.ts';
import { compensateTerminalTasks } from '../src/workers/terminal-compensation.ts';
import { ModelError } from '../src/models/http.ts';
import { enqueueTask } from '../src/referrals/enqueue.ts';
import { seedProject } from './referral-fixtures.ts';
import { Fixtures, testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new Fixtures(db);
let actor: string;
let workspace: string;
let project: string;
let crawl: string;
beforeAll(async () => {
  actor = await fixtures.user();
  workspace = await fixtures.ownedWorkspace(actor);
  project = await seedProject(db, workspace);
  const profile = randomUUID();
  const now = new Date();
  await db
    .insertInto('site_health_profiles')
    .values({
      id: profile,
      workspace_id: workspace,
      project_id: project,
      root_host: 'example.test',
      root_url: 'https://example.test/',
      registrable_domain: 'example.test',
      selection_version: 1,
      created_at: now,
      updated_at: now,
    })
    .execute();
  crawl = randomUUID();
  await db
    .insertInto('site_crawls')
    .values({
      id: crawl,
      workspace_id: workspace,
      project_id: project,
      profile_id: profile,
      root_url: 'https://example.test/',
      random_seed: 'test',
      status: 'completed',
      discovery_status: 'completed',
      analysis_status: 'completed',
      sample_mode: false,
      inventory_complete: true,
      admitted_url_count: 0,
      analyzed_url_count: 0,
      discovered_url_count: 0,
      failed_url_count: 0,
      discovery_requested_count: 0,
      analysis_requested_count: 0,
      partial_reason: '',
      error_message: '',
      extractor_version: '1',
      analyzer_version: '1',
      scoring_version: '1',
      rule_catalog_version: '1',
      created_at: now,
      updated_at: now,
      completed_at: now,
    })
    .execute();
});
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

async function seed(sources = 2) {
  const requests = Array.from({ length: sources }, (_item, index) => ({
    id: randomUUID(),
    candidates: [{ id: randomUUID(), key: 't0' }],
    request: {
      state: { source: index },
      questions: { link_t0: { type: 'noul' }, anchor_t0: { type: 'choice' } },
    },
  }));
  const id = randomUUID();
  await db
    .insertInto('site_internal_link_runs')
    .values({
      id,
      workspace_id: workspace,
      project_id: project,
      crawl_id: crawl,
      actor_id: actor,
      idempotency_key: id,
      state: 'queued',
      policy_version: 1,
      created_at: new Date(),
      manifest: JSON.stringify({ requests, candidates: requests.flatMap((r) => r.candidates) }),
    })
    .execute();
  const taskId = await enqueueTask(db, {
    workspaceId: workspace,
    projectId: project,
    kind: 'internal_link_judgment',
    payload: { run_id: id },
    keyParts: [id],
    maxAttempts: 2,
  });
  const task = await db
    .updateTable('analytics_tasks')
    .set({
      status: 'running',
      lease_owner: 'test',
      lease_expires_at: new Date(Date.now() + 60_000),
    })
    .where('id', '=', taskId!)
    .returningAll()
    .executeTakeFirstOrThrow();
  return { id, task, requests };
}
async function events(id: string, kind: string) {
  return db
    .selectFrom('site_internal_link_events')
    .selectAll()
    .where('run_id', '=', id)
    .where('kind', '=', kind)
    .execute();
}
const context = { db, maxAttempts: 2, checkCancelled: async () => {} };

describe('internal link judgment execution', () => {
  it('commits every dispatch before concurrent sends and maps answers to frozen candidates', async () => {
    const { id, task, requests } = await seed(3);
    let started = 0;
    let release!: () => void;
    const allStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const decide = vi.fn(async (state: unknown) => {
      expect(await events(id, 'dispatch')).toHaveLength(3);
      if (++started === 3) release();
      await allStarted;
      return {
        model: 'fixture',
        usage: { input_tokens: 1 },
        answers: {
          link_t0: { type: 'noul', noul: Number(record(state).source) / 10 },
          anchor_t0: { type: 'choice', choice: 'a0' },
        },
      };
    });
    const execute = internalLinkJudge(() => ({ model: 'fixture', decide }));
    await execute(task, context);
    await execute(task, context);
    expect(decide).toHaveBeenCalledTimes(3);
    const outcomes = await events(id, 'outcome');
    expect(
      new Map(outcomes.map((e) => [e.candidate_id, record(record(e.evidence).answers).link])),
    ).toEqual(
      new Map(
        requests.map((r, index) => [r.candidates[0]!.id, { type: 'noul', noul: index / 10 }]),
      ),
    );
    expect(
      await db
        .selectFrom('analytics_tasks')
        .select('id')
        .where('task_kind', '=', 'internal_link_publish')
        .where('payload', '@>', JSON.stringify({ run_id: id }))
        .execute(),
    ).toHaveLength(1);
  });

  it('closes deadline-limited sends without replaying them', async () => {
    const { id, task } = await seed(1);
    const decide = vi.fn(
      async (_state: unknown, _questions: Record<string, unknown>, signal?: AbortSignal) => {
        await new Promise<void>((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
        });
        return { model: 'fixture', answers: {} };
      },
    );
    const execute = internalLinkJudge(() => ({ model: 'fixture', decide }), {
      ...policy.internal_links,
      job_deadline_seconds: 0.02,
    });
    await execute(task, context);
    await execute(task, context);
    expect(decide).toHaveBeenCalledTimes(1);
    expect((await events(id, 'outcome')).map((e) => e.evidence)).toEqual([
      { state: 'uncertain', reason: 'deadline_exceeded' },
    ]);
  });

  it('settles provider faults as uncertain and fails the task on any other fault', async () => {
    const provider = await seed(1);
    const unavailable = vi.fn(async () => {
      throw new ModelError('connection');
    });
    await internalLinkJudge(() => ({ model: 'fixture', decide: unavailable }))(
      provider.task,
      context,
    );
    expect((await events(provider.id, 'outcome')).map((e) => e.evidence)).toEqual([
      { state: 'uncertain', reason: 'connection' },
    ]);
    const broken = await seed(1);
    const defect = vi.fn(async () => {
      throw new TypeError('defect');
    });
    await expect(
      internalLinkJudge(() => ({ model: 'fixture', decide: defect }))(broken.task, context),
    ).rejects.toThrow('defect');
    expect(await events(broken.id, 'outcome')).toHaveLength(0);
  });

  it('fences stale leases and cancelled runs, and denies viewers before sending', async () => {
    const { id, task } = await seed(1);
    const decide = vi.fn(async () => ({ model: 'fixture', answers: {} }));
    const execute = internalLinkJudge(() => ({ model: 'fixture', decide }));
    await execute({ ...task, lease_owner: 'stale' }, context);
    await db
      .updateTable('site_internal_link_runs')
      .set({ state: 'cancelled' })
      .where('id', '=', id)
      .execute();
    await execute(task, context);
    expect(decide).not.toHaveBeenCalled();
    expect(await events(id, 'dispatch')).toHaveLength(0);
    const viewer = await fixtures.user();
    await fixtures.member(workspace, viewer, 'viewer');
    const denied = await seed(1);
    await db
      .updateTable('site_internal_link_runs')
      .set({ actor_id: viewer })
      .where('id', '=', denied.id)
      .execute();
    await execute(denied.task, context);
    expect((await events(denied.id, 'outcome')).map((e) => e.evidence)).toEqual([
      { state: 'unavailable', reason: 'permission_unavailable' },
    ]);
  });

  it('abandons a permanently failing terminal compensation after the failure bound', async () => {
    const { id, task } = await seed(1);
    await db
      .updateTable('site_internal_link_runs')
      .set({ manifest: JSON.stringify({ candidates: [{ id: 'not-a-uuid' }] }) })
      .where('id', '=', id)
      .execute();
    await db
      .updateTable('analytics_tasks')
      .set({ status: 'failed', lease_owner: null, lease_expires_at: null })
      .where('id', '=', task.id)
      .execute();
    const payload = async () =>
      record(
        (
          await db
            .selectFrom('analytics_tasks')
            .select('payload')
            .where('id', '=', task.id)
            .executeTakeFirstOrThrow()
        ).payload,
      );
    const limit = policy.analytics.terminal_compensation_max_failures;
    for (let attempt = 1; attempt < limit; attempt += 1) await compensateTerminalTasks(db);
    expect(await payload()).toMatchObject({ terminal_compensation_failures: limit - 1 });
    expect((await payload()).terminal_compensated_at).toBeUndefined();
    await compensateTerminalTasks(db);
    await compensateTerminalTasks(db);
    expect(await payload()).toMatchObject({ terminal_compensation_failures: limit });
    expect((await payload()).terminal_compensated_at).toEqual(expect.any(String));
  });

  it('terminal recovery settles unfinished pairs idempotently after lease sweep', async () => {
    const { id, task, requests } = await seed(2);
    await db
      .insertInto('site_internal_link_events')
      .values({
        id: randomUUID(),
        workspace_id: workspace,
        project_id: project,
        run_id: id,
        candidate_id: requests[0]!.candidates[0]!.id,
        kind: 'dispatch',
        evidence: {},
        created_at: new Date(),
      })
      .execute();
    await db
      .updateTable('analytics_tasks')
      .set({ status: 'failed', lease_owner: null, lease_expires_at: null })
      .where('id', '=', task.id)
      .execute();
    await compensateInternalLinks(db, task);
    await compensateTerminalTasks(db);
    await compensateTerminalTasks(db);
    expect((await events(id, 'outcome')).map((e) => record(e.evidence).state).sort()).toEqual([
      'unavailable',
      'uncertain',
    ]);
  });
});
