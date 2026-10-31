import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { internalLinksReadSchema } from '@citeladder/contracts/site-health';

import { createApp } from '../src/app.ts';
import { actionFixture, type ActionSeed } from './action-support.ts';
import { TEST_SESSION_COOKIE, sessionToken, testConfig, testDatabase } from './support.ts';
import { record } from '../src/db/json.ts';
import { publishInternalLinks } from '../src/site-health/internal-link-publish.ts';
import { recomputeOpportunities } from '../src/opportunities/refresh.ts';
import type { LinkCandidate } from '../src/site-health/internal-link-candidates.ts';
import { enqueueTask } from '../src/referrals/enqueue.ts';
import { loadLinkPages } from '../src/site-health/internal-link-pages.ts';
import { policy } from '../src/config.ts';

const config = testConfig();
const db = testDatabase(config);
const app = createApp(config, db);
const seeds: ActionSeed[] = [];
async function request(seed: ActionSeed, suffix = '', body?: unknown) {
  return app.request(`/api/v1/projects/${seed.project_id}/site-health/internal-links${suffix}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      cookie: `${TEST_SESSION_COOKIE}=${await sessionToken({ sub: seed.user_id, ver: 0 })}`,
      'x-workspace-id': seed.workspace_id,
      'content-type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
afterAll(async () => {
  for (const seed of seeds) {
    await db.deleteFrom('workspaces').where('id', '=', seed.workspace_id).execute();
    await db.deleteFrom('users').where('id', '=', seed.user_id).execute();
  }
  await db.destroy();
});

describe('internal link analysis admission', () => {
  it('executes and publishes only the requested analysis once across concurrent requests', async () => {
    const seed = await actionFixture<ActionSeed>('content');
    const other = await actionFixture<ActionSeed>('content');
    seeds.push(seed, other);
    const admit = async (target: ActionSeed) =>
      internalLinksReadSchema.parse(
        await (
          await request(target, '/analyses', {
            crawl_id: target.crawl_id,
            idempotency_key: randomUUID(),
          })
        ).json(),
      ).analysis!.id;
    const id = await admit(seed);
    const otherId = await admit(other);
    expect((await request(other, `/analyses/${id}/run`, {})).status).toBe(404);
    const responses = await Promise.all([
      request(seed, `/analyses/${id}/run`, {}),
      request(seed, `/analyses/${id}/run`, {}),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const result = internalLinksReadSchema.parse(await (await request(seed)).json());
    // With no provider configured, execution publishes honest unavailability immediately.
    expect(result.analysis).toMatchObject({ id, state: 'unavailable' });
    expect(result.analysis!.diagnostics!.pending).toBe(0);
    const tasks = await db
      .selectFrom('analytics_tasks')
      .selectAll()
      .where('workspace_id', '=', seed.workspace_id)
      .where('task_kind', '=', 'internal_link_judgment')
      .execute();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: 'succeeded', attempt_count: 1 });
    expect(
      internalLinksReadSchema.parse(await (await request(other)).json()).analysis,
    ).toMatchObject({ id: otherId, state: 'queued' });
  });
  it('publishes frozen links into page Actions and declares the explicit selection with the other page findings', async () => {
    const seed = await actionFixture<ActionSeed>('content');
    seeds.push(seed);
    const admitted = internalLinksReadSchema.parse(
      await (
        await request(seed, '/analyses', {
          crawl_id: seed.crawl_id,
          idempotency_key: randomUUID(),
        })
      ).json(),
    );
    const runId = admitted.analysis!.id;
    const run = await db
      .selectFrom('site_internal_link_runs')
      .selectAll()
      .where('id', '=', runId)
      .executeTakeFirstOrThrow();
    const candidates = record(run.manifest).candidates as LinkCandidate[];
    const source = candidates[0]!.source;
    const selected = candidates.filter((candidate) => candidate.source === source);
    expect(selected.length).toBeGreaterThan(1);
    for (const candidate of selected) {
      await db
        .insertInto('site_internal_link_events')
        .values({
          id: randomUUID(),
          workspace_id: seed.workspace_id,
          project_id: seed.project_id,
          run_id: runId,
          candidate_id: candidate.id,
          kind: 'outcome',
          created_at: new Date(),
          evidence: JSON.stringify({
            state: 'completed',
            answers: {
              link: { type: 'noul', noul: 0.99 },
              anchor: { type: 'choice', choice: 'a0', confidence: 0.95 },
            },
          }),
        })
        .execute();
    }
    await enqueueTask(db, {
      workspaceId: seed.workspace_id,
      projectId: seed.project_id,
      kind: 'internal_link_publish',
      payload: { run_id: runId },
      keyParts: [runId],
      maxAttempts: 2,
    });
    const task = await db
      .updateTable('analytics_tasks')
      .set({
        status: 'running',
        lease_owner: 'fixture',
        lease_expires_at: new Date(Date.now() + 60_000),
      })
      .where('workspace_id', '=', seed.workspace_id)
      .where('task_kind', '=', 'internal_link_publish')
      .returningAll()
      .executeTakeFirstOrThrow();
    await publishInternalLinks(task, { db, checkCancelled: async () => {}, maxAttempts: 2 });
    const progress = internalLinksReadSchema.parse(await (await request(seed)).json());
    expect(progress.analysis!.state).toBe('running');
    expect(progress.analysis!.recommendations.length).toBeGreaterThan(0);
    expect(progress.analysis!.diagnostics!.pending).toBeGreaterThan(0);
    const selectedIds = new Set(selected.map((candidate) => candidate.id));
    const remaining = (record(run.manifest).candidates as { id: string }[]).filter(
      (candidate) => !selectedIds.has(candidate.id),
    );
    await db
      .insertInto('site_internal_link_events')
      .values(
        remaining.map((candidate) => ({
          id: randomUUID(),
          workspace_id: seed.workspace_id,
          project_id: seed.project_id,
          run_id: runId,
          candidate_id: candidate.id,
          kind: 'outcome',
          created_at: new Date(),
          evidence: JSON.stringify({ state: 'unavailable', reason: 'deadline_exceeded' }),
        })),
      )
      .execute();
    await publishInternalLinks(task, { db, checkCancelled: async () => {}, maxAttempts: 2 });
    await recomputeOpportunities(
      db,
      { workspaceId: seed.workspace_id, projectId: seed.project_id },
      { skipIfCurrent: true },
    );
    const result = internalLinksReadSchema.parse(await (await request(seed)).json());
    // Overlap filtering can retain a different candidate from the same source.
    const link = result.analysis!.recommendations.find((item) => selectedIds.has(item.id))!;
    expect(link).toBeDefined();
    expect(link.action_id).not.toBeNull();
    const contextualMember = await db
      .selectFrom('opportunities')
      .selectAll()
      .where('action_id', '=', link.action_id!)
      .where('rule_id', '=', 'site_contextual_links')
      .where('superseded_at', 'is', null)
      .executeTakeFirstOrThrow();
    await db
      .insertInto('opportunities')
      .values({
        ...contextualMember,
        id: randomUUID(),
        rule_id: 'missing_structured_data',
        target_key: 'fixture:unrelated',
        evidence: JSON.stringify({ site_url_id: link.source.site_url_id }),
        source_analysis_ids: JSON.stringify([]),
        source_issue_ids: JSON.stringify([]),
        source_metric_ids: JSON.stringify([]),
      })
      .execute();
    const key = randomUUID();
    // Declarations must fall inside the verification window, so stay relative to now.
    const declaredAt = new Date(Date.now() - 86_400_000).toISOString();
    const declare = (ids: string[]) =>
      app.request(`/api/v1/actions/${link.action_id}/declaration`, {
        method: 'POST',
        headers: {
          cookie: `${TEST_SESSION_COOKIE}=${token}`,
          'x-workspace-id': seed.workspace_id,
          'content-type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify({
          declared_implemented_at: declaredAt,
          recommendation_ids: ids,
        }),
      });
    const token = await sessionToken({ sub: seed.user_id, ver: 0 });
    expect((await declare([randomUUID()])).status).toBe(409);
    const declaration = await declare([link.id]);
    expect(declaration.status).toBe(201);
    const saved = await db
      .selectFrom('opportunity_implementation_events')
      .select(['expected_checks', 'member_opportunity_ids'])
      .where('action_id', '=', link.action_id!)
      .executeTakeFirstOrThrow();
    const checks = saved.expected_checks as Record<string, unknown>[];
    expect(checks.filter((check) => check.kind === 'contextual_link')).toEqual([
      expect.objectContaining({ recommendation_id: link.id }),
    ]);
    expect(checks.some((check) => check.kind !== 'contextual_link')).toBe(true);
    const declaredMembers = saved.member_opportunity_ids as string[];
    expect(declaredMembers).toContain(contextualMember.id);
    expect(declaredMembers.length).toBeGreaterThan(1);
    expect((await declare([link.id])).status).toBe(200);
    expect((await declare(selected.map((candidate) => candidate.id))).status).toBe(409);
  });
  it('replays concurrent requests, isolates manifests, and cancels without changing crawl evidence', async () => {
    const seed = await actionFixture<ActionSeed>('content');
    seeds.push(seed);
    const input = { crawl_id: seed.crawl_id, idempotency_key: randomUUID() };
    const replies = await Promise.all([
      request(seed, '/analyses', input),
      request(seed, '/analyses', input),
    ]);
    expect(replies.map((reply) => reply.status)).toEqual([202, 202]);
    const [first, replay] = await Promise.all(
      replies.map(async (reply) => internalLinksReadSchema.parse(await reply.json())),
    );
    expect(first!.analysis!.id).toBe(replay!.analysis!.id);
    expect((await request(seed, '/analyses', { ...input, crawl_id: randomUUID() })).status).toBe(
      409,
    );
    expect(
      (await request(seed, '/analyses', { ...input, idempotency_key: randomUUID() })).status,
    ).toBe(409);
    const other = await actionFixture<ActionSeed>('content');
    seeds.push(other);
    expect((await request(other, `?analysis_id=${first!.analysis!.id}`)).status).toBe(404);
    const cancelled = await request(seed, `/analyses/${first!.analysis!.id}/cancel`, {});
    expect(internalLinksReadSchema.parse(await cancelled.json()).analysis?.state).toBe('cancelled');
    const saved = await db
      .selectFrom('site_internal_link_runs')
      .select('manifest')
      .where('id', '=', first!.analysis!.id)
      .executeTakeFirstOrThrow();
    expect(saved.manifest).toMatchObject({ page_count: 3 });
    // The cancelled run's judgment task has not settled, so the slot stays occupied.
    const replacement = { crawl_id: seed.crawl_id, idempotency_key: randomUUID() };
    expect((await request(seed, '/analyses', replacement)).status).toBe(409);
    await db
      .updateTable('analytics_tasks')
      .set({ status: 'succeeded' })
      .where('workspace_id', '=', seed.workspace_id)
      .where('task_kind', '=', 'internal_link_judgment')
      .execute();
    expect((await request(seed, '/analyses', replacement)).status).toBe(202);
  });

  it('bounds daily analyses per workspace while replays stay free', async () => {
    const seed = await actionFixture<ActionSeed>('content');
    const other = await actionFixture<ActionSeed>('content');
    seeds.push(seed, other);
    vi.stubEnv('ABUSE_INTERNAL_LINK_ANALYSES_PER_WORKSPACE_DAILY', '1');
    try {
      const input = { crawl_id: seed.crawl_id, idempotency_key: randomUUID() };
      expect((await request(seed, '/analyses', input)).status).toBe(202);
      expect((await request(seed, '/analyses', input)).status).toBe(202);
      // Free the active slot so only the daily window can refuse the next run.
      await db
        .updateTable('site_internal_link_runs')
        .set({ state: 'cancelled' })
        .where('workspace_id', '=', seed.workspace_id)
        .execute();
      await db
        .updateTable('analytics_tasks')
        .set({ status: 'succeeded' })
        .where('workspace_id', '=', seed.workspace_id)
        .where('task_kind', '=', 'internal_link_judgment')
        .execute();
      const refused = await request(seed, '/analyses', {
        crawl_id: seed.crawl_id,
        idempotency_key: randomUUID(),
      });
      expect(refused.status).toBe(429);
      const runs = await db
        .selectFrom('site_internal_link_runs')
        .select('id')
        .where('workspace_id', '=', seed.workspace_id)
        .execute();
      expect(runs).toHaveLength(1);
      const elsewhere = { crawl_id: other.crawl_id, idempotency_key: randomUUID() };
      expect((await request(other, '/analyses', elsewhere)).status).toBe(202);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('fills the page cap with eligible pages, not the alphabetically first rows', async () => {
    const seed = await actionFixture<ActionSeed>('content');
    seeds.push(seed);
    const scope = { workspaceId: seed.workspace_id, projectId: seed.project_id };
    const first = await db
      .selectFrom('site_page_analyses as analysis')
      .innerJoin('site_urls as url', 'url.id', 'analysis.site_url_id')
      .select('analysis.artifact_id')
      .where('analysis.workspace_id', '=', seed.workspace_id)
      .where('analysis.crawl_id', '=', seed.crawl_id)
      .orderBy('url.normalized_url')
      .executeTakeFirstOrThrow();
    await db
      .updateTable('site_fetch_artifacts')
      .set({
        normalized_facts: sql`jsonb_set(normalized_facts, '{extraction,truncated}', 'true'::jsonb)`,
      })
      .where('id', '=', first.artifact_id)
      .execute();
    const limits = policy.internal_links as { max_pages: number };
    const cap = limits.max_pages;
    limits.max_pages = 2;
    try {
      const { pages, omittedPages } = await loadLinkPages(db, scope, seed.crawl_id);
      expect(pages).toHaveLength(2);
      expect(pages.map((page) => page.artifact_id)).not.toContain(first.artifact_id);
      expect(omittedPages).toBe(0);
      const source = pages[0]!;
      expect(source.source_passages?.length).toBeGreaterThan(0);
      await db
        .updateTable('site_fetch_artifacts')
        .set({
          normalized_facts: sql`jsonb_set(normalized_facts, '{primary_content_truncated}', 'true'::jsonb)`,
        })
        .where('id', '=', source.artifact_id)
        .where('workspace_id', '=', seed.workspace_id)
        .execute();
      const loaded = await loadLinkPages(db, scope, seed.crawl_id);
      const truncated = loaded.pages.find((page) => page.analysis_id === source.analysis_id)!;
      expect(truncated.source_passages).toBeNull();
      expect(truncated.eligible_target).toBe(true);
    } finally {
      limits.max_pages = cap;
    }
  });
});
