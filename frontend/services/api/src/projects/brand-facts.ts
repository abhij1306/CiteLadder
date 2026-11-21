import { randomUUID } from 'node:crypto';

import {
  factStatusSchema,
  factTopicSchema,
  type BrandFact,
  type BrandFactImportResult,
  type BrandFactList,
} from '@citeladder/contracts/fact-checking';
import { asApiErrorCode } from '@citeladder/contracts/error-codes';
import {
  brandFactCreateRequestSchema,
  brandFactImportRequestSchema,
  brandFactUpdateRequestSchema,
} from '@citeladder/contracts/project-requests';
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

export const brandFactCreate = brandFactCreateRequestSchema.extend({
  statement,
  source_url: sourceUrl,
});

export const brandFactUpdate = brandFactUpdateRequestSchema.extend({
  statement: statement.optional(),
  source_url: sourceUrl,
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
  const formLimits = {
    statement_max_chars: limits.statement_max_chars,
    facts_import_max_rows: limits.facts_import_max_rows,
  };
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
  return { enabled: true, facts, limits: formLimits };
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

export function createBrandFact(
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

export const brandFactImport = brandFactImportRequestSchema.extend({
  rows: brandFactImportRequestSchema.shape.rows.min(1).max(limits.facts_import_max_rows),
});

const ROW_ERRORS: Record<string, string> = {
  topic: `Topic must be one of: ${factTopicSchema.options.join(', ')}.`,
  statement: `Statement is required, up to ${limits.statement_max_chars} characters.`,
  source_url: 'Source URL must be an http or https address.',
};

function factKey(topic: string, statement: string) {
  return `${topic}\n${statement.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()}`;
}

export function importBrandFacts(
  db: Database,
  scope: ProjectScope,
  userId: string,
  input: z.output<typeof brandFactImport>,
): Promise<BrandFactImportResult> {
  return db.transaction().execute(async (trx) => {
    await acquireProjectLock(trx, scope.projectId);
    const kept = await trx
      .selectFrom('brand_facts')
      .select(['topic', 'statement'])
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('status', '!=', 'retired')
      .execute();
    const seen = new Set(kept.map((fact) => factKey(fact.topic, fact.statement)));
    let room = limits.max_facts_per_project - kept.length;
    const now = new Date();
    const created: Selectable<BrandFacts>[] = [];
    const rows = input.rows.map((raw, index): BrandFactImportResult['rows'][number] => {
      const parsed = brandFactCreate.safeParse({
        topic: raw.topic.trim().toLowerCase(),
        statement: raw.statement,
        source_url: raw.source_url?.trim() || null,
      });
      if (!parsed.success) {
        const field = String(parsed.error.issues[0]?.path[0] ?? 'statement');
        return { index, kind: 'invalid', message: ROW_ERRORS[field] ?? ROW_ERRORS.statement! };
      }
      const key = factKey(parsed.data.topic, parsed.data.statement);
      if (seen.has(key)) return { index, kind: 'duplicate' };
      if (room <= 0)
        return {
          index,
          kind: 'invalid',
          message: `A project can hold ${limits.max_facts_per_project} facts.`,
        };
      seen.add(key);
      room--;
      const fact = {
        id: randomUUID(),
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        revision: 1,
        topic: parsed.data.topic,
        statement: parsed.data.statement,
        source_url: parsed.data.source_url ?? null,
        status: 'draft',
        created_at: now,
        updated_at: now,
      };
      created.push(fact);
      return { index, kind: 'created', fact_id: fact.id };
    });
    if (created.length) {
      await trx.insertInto('brand_facts').values(created).execute();
      await trx
        .insertInto('brand_fact_revisions')
        .values(created.map((fact) => revisionOf(fact, userId)))
        .execute();
    }
    return { rows };
  });
}

export function updateBrandFact(
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
