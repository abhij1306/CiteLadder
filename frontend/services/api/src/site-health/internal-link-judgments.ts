/** Committed dispatches, bounded concurrent JEV calls, and lease-fenced outcomes. */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import { roleAllows } from '../auth/workspace.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { createJevClient, type JevClient } from '../models/jev.ts';
import { meterFor } from '../models/metering.ts';
import { ModelError, providerErrorCode } from '../models/http.ts';
import { enqueueTask } from '../referrals/enqueue.ts';
import type { QueueTask } from '../queue/task-queue.ts';
import { payloadString, taskProject, type Executor } from '../workers/executor.ts';

const requestSchema = z.object({
  id: z.uuid(),
  candidates: z.array(z.object({ id: z.uuid(), key: z.string() })),
  request: z.object({ state: z.unknown(), questions: z.record(z.string(), z.unknown()) }),
});
type LinkRequest = z.infer<typeof requestSchema>;
type Outcome = { id: string; evidence: Record<string, unknown> };

async function lockedRun(db: Database, task: QueueTask, terminal = false) {
  let lease = db
    .selectFrom('analytics_tasks')
    .select('id')
    .where('id', '=', task.id)
    .where('workspace_id', '=', task.workspace_id)
    .where('project_id', '=', task.project_id)
    .forUpdate();
  lease = lease.where((eb) =>
    eb.or([
      eb.and([
        eb('lease_owner', '=', task.lease_owner),
        eb('status', '=', 'running'),
        eb('lease_expires_at', '>', sql<Date>`clock_timestamp()`),
      ]),
      ...(terminal ? [eb('status', '=', 'failed')] : []),
    ]),
  );
  if (!(await lease.executeTakeFirst())) return undefined;
  const id = payloadString(task, 'run_id');
  if (!id) throw new Error('Internal link judgment missing run');
  return db
    .selectFrom('site_internal_link_runs')
    .selectAll()
    .where('id', '=', id)
    .where('workspace_id', '=', task.workspace_id)
    .where('project_id', '=', task.project_id)
    .forUpdate()
    .executeTakeFirst();
}

async function appendOutcomes(
  db: Database,
  run: { id: string; workspace_id: string; project_id: string },
  outcomes: Outcome[],
) {
  if (!outcomes.length) return;
  await db
    .insertInto('site_internal_link_events')
    .values(
      outcomes.map(({ id, evidence }) => ({
        id: randomUUID(),
        workspace_id: run.workspace_id,
        project_id: run.project_id,
        run_id: run.id,
        candidate_id: id,
        kind: 'outcome',
        evidence: JSON.stringify(evidence),
        created_at: new Date(),
      })),
    )
    .onConflict((oc) => oc.columns(['run_id', 'candidate_id', 'kind']).doNothing())
    .execute();
}

async function publish(db: Database, task: QueueTask, revision: string, terminal = false) {
  await db.transaction().execute(async (trx) => {
    const run = await lockedRun(trx, task, terminal);
    if (!run) return;
    await enqueueTask(trx, {
      workspaceId: run.workspace_id,
      projectId: run.project_id,
      kind: 'internal_link_publish',
      payload: { run_id: run.id },
      keyParts: [run.project_id, run.id, `${task.id}:${revision}`],
      maxAttempts: task.max_attempts,
    });
  });
}

function prepare(db: Database, task: QueueTask, client: JevClient | null) {
  return db.transaction().execute(async (trx) => {
    const run = await lockedRun(trx, task);
    if (!run || run.state === 'cancelled') return [];
    const requests = requestSchema.array().parse(record(run.manifest).requests);
    const membership = await trx
      .selectFrom('workspace_members')
      .select('role')
      .where('workspace_id', '=', run.workspace_id)
      .where('user_id', '=', run.actor_id)
      .executeTakeFirst();
    let reason = client ? '' : 'provider_unconfigured';
    if (!membership || !roleAllows(membership.role, 'run')) reason = 'permission_unavailable';
    const events = await trx
      .selectFrom('site_internal_link_events')
      .select(['candidate_id', 'kind'])
      .where('workspace_id', '=', run.workspace_id)
      .where('project_id', '=', run.project_id)
      .where('run_id', '=', run.id)
      .execute();
    const completed = new Set(
      events.filter((e) => e.kind === 'outcome').map((e) => e.candidate_id),
    );
    const dispatched = new Set(
      events.filter((e) => e.kind === 'dispatch').map((e) => e.candidate_id),
    );
    const sendable: LinkRequest[] = [];
    const closed: Outcome[] = [];
    for (const request of requests) {
      const open = request.candidates.filter((c) => !completed.has(c.id));
      if (!open.length) continue;
      if (open.some((c) => dispatched.has(c.id)) || reason) {
        closed.push(
          ...open.map(({ id }) => ({
            id,
            evidence: {
              state: dispatched.has(id) ? 'uncertain' : 'unavailable',
              reason: dispatched.has(id)
                ? 'interrupted_dispatch'
                : reason || 'interrupted_dispatch',
            },
          })),
        );
        continue;
      }
      await trx
        .insertInto('site_internal_link_events')
        .values(
          open.map(({ id }) => ({
            id: randomUUID(),
            workspace_id: run.workspace_id,
            project_id: run.project_id,
            run_id: run.id,
            candidate_id: id,
            kind: 'dispatch',
            created_at: new Date(),
            evidence: JSON.stringify({
              request_id: request.id,
              model: client!.model,
              policy_version: run.policy_version,
            }),
          })),
        )
        .execute();
      sendable.push({ ...request, candidates: open });
    }
    await appendOutcomes(trx, run, closed);
    return sendable;
  });
}

async function judge(
  client: JevClient,
  request: LinkRequest,
  signal: AbortSignal,
): Promise<Outcome[]> {
  const started = performance.now();
  try {
    const decision = await client.decide(request.request.state, request.request.questions, signal);
    return request.candidates.map(({ id, key }) => ({
      id,
      evidence: {
        state: 'completed',
        request_id: request.id,
        model: decision.model,
        usage: decision.usage ?? null,
        latency_ms: Math.round(performance.now() - started),
        answers: {
          link: decision.answers[`link_${key}`],
          anchor: decision.answers[`anchor_${key}`],
        },
      },
    }));
  } catch (error) {
    // Only a provider fault or the job deadline settles as uncertain; any
    // other fault fails the task so it retries and terminal compensation runs.
    let reason = 'deadline_exceeded';
    if (!signal.aborted) {
      if (!(error instanceof ModelError)) throw error;
      reason = error.status ? providerErrorCode(error.status) : error.code;
    }
    return request.candidates.map(({ id }) => ({ id, evidence: { state: 'uncertain', reason } }));
  }
}

export async function compensateInternalLinks(
  db: Database,
  task: QueueTask,
  reason = 'interrupted_dispatch',
) {
  await db.transaction().execute(async (trx) => {
    const run = await lockedRun(trx, task, true);
    if (!run) return;
    const candidates = z.array(z.object({ id: z.uuid() })).parse(record(run.manifest).candidates);
    const events = await trx
      .selectFrom('site_internal_link_events')
      .select(['candidate_id', 'kind'])
      .where('workspace_id', '=', run.workspace_id)
      .where('project_id', '=', run.project_id)
      .where('run_id', '=', run.id)
      .execute();
    const finished = new Set(events.filter((e) => e.kind === 'outcome').map((e) => e.candidate_id));
    const dispatched = new Set(
      events.filter((e) => e.kind === 'dispatch').map((e) => e.candidate_id),
    );
    await appendOutcomes(
      trx,
      run,
      candidates
        .filter((c) => !finished.has(c.id))
        .map(({ id }) => ({
          id,
          evidence: { state: dispatched.has(id) ? 'uncertain' : 'unavailable', reason },
        })),
    );
  });
  await publish(db, task, 'complete', true);
}

export function internalLinkJudge(
  clientFactory: () => JevClient | null = createJevClient,
  settings = policy.internal_links,
): Executor {
  return async (task, { db }) => {
    await taskProject(db, task);
    const raw = clientFactory();
    // Recorded, not charged.
    const client = raw && meterFor(db, task.workspace_id).jev(raw, 'internal_link_judge');
    const requests = await prepare(db, task, client);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), settings.job_deadline_seconds * 1000);
    const pending = new Set<Promise<Outcome[]>>();
    for (const request of requests) {
      const call = judge(client!, request, controller.signal);
      pending.add(call);
    }
    let buffer: Outcome[] = [];
    let written = 0;
    let published = 0;
    try {
      while (pending.size) {
        const { call, outcomes } = await Promise.race(
          [...pending].map(async (call) => ({ call, outcomes: await call })),
        );
        pending.delete(call);
        buffer.push(...outcomes);
        if (pending.size && buffer.length < settings.outcome_batch) continue;
        const owned = await db.transaction().execute(async (trx) => {
          const run = await lockedRun(trx, task);
          if (!run) return false;
          await appendOutcomes(trx, run, buffer);
          return true;
        });
        if (!owned) return;
        written += buffer.length;
        buffer = [];
        if (written - published >= settings.publish_every) {
          published = written;
          await publish(db, task, String(written));
        }
      }
      await publish(db, task, 'complete');
    } finally {
      clearTimeout(deadline);
      controller.abort();
      await Promise.allSettled(pending);
    }
  };
}
