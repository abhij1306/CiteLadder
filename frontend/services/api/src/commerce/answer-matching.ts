/**
 * `commerce_answer_matching`: re-match stored answers against a new catalog
 * revision (CM1).
 *
 * The successful answers of the project's last `backfill_days` that have no
 * pass for this revision and the current versions are matched in bounded
 * batches, one transaction per batch. Matching is deterministic only (token
 * and URL rules, carousel cards): the model resolver is never called. Each
 * pass is unique on answer, revision and versions, so a retried or repeated
 * task records nothing twice; a revision a newer one superseded stops before
 * its next batch, since the newer revision's own task re-matches the same
 * answers. A matched window asks for an Opportunity refresh, since the new
 * passes move the per-product findings. Leases,
 * retries and cancellation stay with the shared analytics worker.
 */
import { z } from 'zod';

import { policy } from '../config.ts';
import { auditPolicy } from '../audits/config.ts';
import type { Database } from '../db/database.ts';
import { enqueueDerivedOpportunityRefresh } from '../opportunities/enqueue.ts';
import { payloadString, taskProject, type Executor } from '../queue/executor.ts';
import { loadRevision, recordCatalogRevision, revisionShelf } from './catalog-revisions.ts';
import { ownedHosts } from './discovery-validation.ts';
import type { CommerceScope } from './reads.ts';
import {
  auditLocale,
  promptTarget,
  recordPass,
  type PassContext,
  type StoredAnswer,
} from './shelf.ts';
import { prepareRecommendations } from './shelf-parsing.ts';

type Revision = NonNullable<Awaited<ReturnType<typeof loadRevision>>>;

/** Answers in the window with no pass for this revision and versions, oldest first. */
function pendingAnswers(db: Database, scope: CommerceScope, revisionId: string, since: Date) {
  const versions = auditPolicy.commerce_versions;
  return db
    .selectFrom('audit_tasks as t')
    .innerJoin('raw_response_artifacts as r', 'r.id', 't.result_artifact_id')
    .select([
      't.id as task_id',
      't.audit_id',
      't.prompt_snapshot_id',
      'r.id as artifact_id',
      'r.answer_text',
      'r.provider_metadata',
      'r.citations',
      'r.created_at',
    ])
    .where('t.workspace_id', '=', scope.workspaceId)
    .where('t.project_id', '=', scope.projectId)
    .where('t.status', '=', 'succeeded')
    .whereRef('r.task_id', '=', 't.id')
    .where('r.created_at', '>=', since)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('commerce_match_passes as p')
            .select('p.id')
            .where('p.workspace_id', '=', scope.workspaceId)
            .whereRef('p.artifact_id', '=', 'r.id')
            .where('p.catalog_revision_id', '=', revisionId)
            .where('p.parser_version', '=', versions.parser_version)
            .where('p.matcher_version', '=', versions.matcher_version),
        ),
      ),
    )
    .orderBy('r.created_at')
    .orderBy('r.id')
    .limit(policy.commerce.answer_matching.batch_size)
    .execute();
}

/** Match one batch; the number of answers it read. */
async function matchBatch(db: Database, scope: CommerceScope, revision: Revision, since: Date) {
  const answers = await pendingAnswers(db, scope, revision.id, since);
  if (!answers.length) return 0;
  const audits = await db
    .selectFrom('audits')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', 'in', [...new Set(answers.map((row) => row.audit_id))])
    .execute();
  const owned = await ownedHosts(db, scope);
  const current = auditPolicy.commerce_versions;
  const passes: { ctx: PassContext; answer: StoredAnswer }[] = [];
  for (const row of answers) {
    const audit = audits.find((candidate) => candidate.id === row.audit_id);
    // A task's audit is in its project; anything else must not loop on the same batch.
    if (!audit) throw new Error('Commerce answer audit is outside its project');
    const target = await promptTarget(db, audit, row.prompt_snapshot_id); // NOSONAR -- Reads only; one batch is bounded.
    passes.push({
      ctx: {
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        auditId: audit.id,
        taskId: row.task_id,
        target,
        catalog: revisionShelf(revision.identity, target),
        revisionId: revision.id,
        mode: 'backfill',
        versions: {
          parser: current.parser_version,
          matcher: current.matcher_version,
          resolver: current.resolver_template_version,
        },
        owned,
        locale: auditLocale(audit),
      },
      answer: {
        artifactId: row.artifact_id,
        answerText: row.answer_text,
        providerMetadata: row.provider_metadata,
        citations: row.citations,
        capturedAt: row.created_at,
      },
    });
  }
  await db.transaction().execute(async (trx) => {
    for (const { ctx, answer } of passes) {
      // Deterministic: no resolver, so no model call inside the transaction.
      const prepared = await prepareRecommendations(answer.answerText, ctx.catalog); // NOSONAR -- Local parsing; one answer at a time.
      await recordPass(trx, ctx, answer, prepared); // NOSONAR -- One transaction: statements run in order.
    }
  });
  return answers.length;
}

export const matchAnswers: Executor = async (task, { db, checkCancelled }) => {
  const scope = { workspaceId: task.workspace_id, projectId: await taskProject(db, task) };
  const revisionId = payloadString(task, 'catalog_revision_id');
  if (!revisionId) {
    // Crawl projection asked for a revision; a new one queues its own backfill.
    const crawl = z.uuid().safeParse(payloadString(task, 'crawl_id'));
    await db.transaction().execute((trx) =>
      recordCatalogRevision(trx, scope, {
        kind: 'projection',
        id: crawl.success ? crawl.data : null,
      }),
    );
    return;
  }
  const revision = await loadRevision(db, scope, z.uuid().parse(revisionId));
  if (!revision) return;
  const superseded = async () =>
    Boolean(
      await db
        .selectFrom('commerce_catalog_revisions')
        .select('id')
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('revision_number', '>', revision.revision_number)
        .executeTakeFirst(),
    );
  const days = policy.commerce.answer_matching.backfill_days;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  for (;;) {
    await checkCancelled('commerce answer matching batch');
    // A revision recorded mid-run queues its own task; this one stops at the next batch.
    if (await superseded()) return; // NOSONAR -- Checked before each batch, in order.
    const matched = await matchBatch(db, scope, revision, since); // NOSONAR -- Batches run in order until the window is matched.
    if (matched < policy.commerce.answer_matching.batch_size) break;
  }
  // The backfill's passes are new Commerce evidence (the newest match pass);
  // a retry finds no pending answer and asks again, so the request survives a crash.
  await enqueueDerivedOpportunityRefresh(db, {
    ...scope,
    triggerKind: 'commerce_catalog_revision',
    triggerId: revision.id,
  });
};
