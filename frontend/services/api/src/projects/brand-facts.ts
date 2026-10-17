/**
 * Brand facts: the user-owned statements fact-checking compares answers
 * against. Gated by the workspace's `fact_checking` grant (the pilot).
 *
 * Every change appends a `brand_fact_revisions` row and moves the fact's
 * current revision; an edit names the revision it read, so a stale edit is a
 * conflict, never a silent overwrite. Audits freeze the confirmed revisions
 * they check against, so later edits never rewrite an earlier verdict.
 */
import { randomUUID } from 'node:crypto';

import {
  factStatusSchema,
  factTopicSchema,
  type BrandFact,
  type BrandFactList,
} from '@citeladder/contracts/fact-checking';
import { asApiErrorCode } from '@citeladder/contracts/error-codes';
import type { Selectable } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import { factTopicOrder } from '../config/perception.ts';
import type { Database } from '../db/database.ts';
import { ApiError, notFound } from '../errors.ts';
import type { BrandFacts } from '../generated/db-schema.ts';
import { acquireProjectLock } from '../prompts/locks.ts';
import type { ProjectScope } from './brand-profile.ts';

const limits = policy.perception.fact_check;

const statement = z.string().trim().min(1).max(limits.statement_max_chars);
const sourceUrl = z
  .url({ protocol: /^https?$/u })
  .max(limits.source_url_max_chars)
  .nullish();

export const brandFactCreate = z.object({
  topic: factTopicSchema,
  statement,
  source_url: sourceUrl,
});

/** A partial edit of the revision the editor read; absent fields are kept. */
export const brandFactUpdate = z.object({
  expected_revision: z.int().positive(),
  topic: factTopicSchema.optional(),
  statement: statement.optional(),
  // Null clears the source; absent keeps it.
  source_url: sourceUrl,
  status: factStatusSchema.optional(),
});

function view(row: Selectable<BrandFacts>): BrandFact {
  return {
    id: row.id,
    topic: factTopicSchema.parse(row.topic),
    statement: row.statement,
    source_url: row.source_url,
    status: factStatusSchema.parse(row.status),
    revision: row.revision,
    updated_at: row.updated_at.toISOString(),
  };
}

/** The project's facts by topic, confirmed first. */
export async function listBrandFacts(db: Database, scope: ProjectScope): Promise<BrandFactList> {
  const rows = await db
    .selectFrom('brand_facts')
    .selectAll()
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const status = ['confirmed', 'draft', 'retired'];
  const facts = rows
    .map(view)
    .sort(
      (a, b) =>
        (factTopicOrder.get(a.topic) ?? 0) - (factTopicOrder.get(b.topic) ?? 0) ||
        status.indexOf(a.status) - status.indexOf(b.status),
    );
  return { enabled: true, facts };
}

function revisionOf(row: Selectable<BrandFacts>, userId: string | null) {
  return {
    id: randomUUID(),
    workspace_id: row.workspace_id,
    fact_id: row.id,
    revision: row.revision,
    topic: row.topic,
    statement: row.statement,
    source_url: row.source_url,
    status: row.status,
    created_by_user_id: userId,
    created_at: row.updated_at,
  };
}

/** A new draft fact; drafts are never checked against until confirmed. */
export async function createBrandFact(
  db: Database,
  scope: ProjectScope,
  userId: string,
  input: z.output<typeof brandFactCreate>,
): Promise<BrandFact> {
  return db.transaction().execute(async (trx) => {
    await acquireProjectLock(trx, scope.projectId);
    const { count } = await trx
      .selectFrom('brand_facts')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('status', '!=', 'retired')
      .executeTakeFirstOrThrow();
    if (Number(count) >= limits.max_facts_per_project)
      throw new ApiError(409, `A project can hold ${limits.max_facts_per_project} facts`, {
        code: asApiErrorCode('fact_limit_reached'),
      });
    const now = new Date();
    const row = await trx
      .insertInto('brand_facts')
      .values({
        id: randomUUID(),
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        revision: 1,
        topic: input.topic,
        statement: input.statement,
        source_url: input.source_url ?? null,
        status: 'draft',
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx.insertInto('brand_fact_revisions').values(revisionOf(row, userId)).execute();
    return view(row);
  });
}

/** Apply an edit to the revision the editor read, appending the next revision. */
export async function updateBrandFact(
  db: Database,
  scope: ProjectScope,
  userId: string,
  factId: string,
  input: z.output<typeof brandFactUpdate>,
): Promise<BrandFact> {
  return db.transaction().execute(async (trx) => {
    await acquireProjectLock(trx, scope.projectId);
    const current = await trx
      .selectFrom('brand_facts')
      .selectAll()
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('id', '=', factId)
      .executeTakeFirst();
    if (!current) throw notFound('Fact');
    if (current.status === 'retired')
      throw new ApiError(409, 'A retired fact is kept for earlier runs and cannot change');
    if (current.revision !== input.expected_revision)
      throw new ApiError(409, 'This fact changed since it was loaded; reload and try again');
    const next = {
      topic: input.topic ?? current.topic,
      statement: input.statement ?? current.statement,
      source_url: input.source_url === undefined ? current.source_url : input.source_url,
      status: input.status ?? current.status,
    };
    const unchanged =
      next.topic === current.topic &&
      next.statement === current.statement &&
      next.source_url === current.source_url &&
      next.status === current.status;
    if (unchanged) return view(current);
    const row = await trx
      .updateTable('brand_facts')
      .set({ ...next, revision: current.revision + 1, updated_at: new Date() })
      .where('workspace_id', '=', scope.workspaceId)
      .where('id', '=', factId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx.insertInto('brand_fact_revisions').values(revisionOf(row, userId)).execute();
    return view(row);
  });
}
