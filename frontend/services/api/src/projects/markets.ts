import { randomUUID } from 'node:crypto';

import {
  marketLabel,
  type ProjectMarket,
  type projectMarketCreateSchema,
} from '@citeladder/contracts/markets';
import { sql } from 'kysely';
import type { z } from 'zod';

import type { Database } from '../db/database.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { ApiError, notFound } from '../errors.ts';
import { acquireProjectLock } from '../prompts/locks.ts';
import type { ProjectScope } from './brand-profile.ts';

export type MarketId = string | null;
export type Market = { id: MarketId; country_code: string; language_code: string };

async function projectDefault(db: Database, scope: ProjectScope): Promise<Market> {
  const project = await db
    .selectFrom('projects')
    .select(['country_code', 'language_code'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('id', '=', scope.projectId)
    .executeTakeFirst();
  if (!project) throw notFound('Project');
  return { id: null, ...project };
}

function extraMarkets(db: Database, scope: ProjectScope) {
  return db
    .selectFrom('project_markets')
    .select(['id', 'label', 'country_code', 'language_code', 'created_at'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId);
}

export async function listMarkets(db: Database, scope: ProjectScope): Promise<ProjectMarket[]> {
  const fallback = await projectDefault(db, scope);
  const rows = await extraMarkets(db, scope).orderBy('created_at').orderBy('id').execute();
  return [
    { ...fallback, label: marketLabel(fallback), is_default: true, created_at: null },
    ...rows.map((row) => ({
      ...row,
      label: row.label || marketLabel(row),
      is_default: false,
      created_at: row.created_at.toISOString(),
    })),
  ];
}

export function addMarket(
  db: Database,
  scope: ProjectScope,
  input: z.output<typeof projectMarketCreateSchema>,
) {
  return db.transaction().execute(async (trx) => {
    await acquireProjectLock(trx, scope.projectId);
    const fallback = await projectDefault(trx, scope);
    if (
      fallback.country_code.toUpperCase() === input.country_code &&
      fallback.language_code === input.language_code
    )
      throw new ApiError(409, "This is already the project's default market", {
        code: 'market_exists',
      });
    try {
      await trx
        .insertInto('project_markets')
        .values({
          id: randomUUID(),
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          label: input.label,
          country_code: input.country_code,
          language_code: input.language_code,
          created_at: new Date(),
        })
        .execute();
    } catch (error) {
      if (isUniqueViolation(error, 'uq_project_markets_market'))
        throw new ApiError(409, 'This project already measures that market', {
          code: 'market_exists',
        });
      throw error;
    }
    return listMarkets(trx, scope);
  });
}

export function deleteMarket(db: Database, scope: ProjectScope, marketId: string): Promise<void> {
  return db.transaction().execute(async (trx) => {
    await acquireProjectLock(trx, scope.projectId);
    const deleted = await trx
      .deleteFrom('project_markets')
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('id', '=', marketId)
      .returning('id')
      .executeTakeFirst();
    if (!deleted) throw notFound('Market');
    const removed = JSON.stringify(marketId);
    await trx
      .updateTable('audit_schedules')
      .set({
        market_ids: sql<string>`coalesce(
          (select jsonb_agg(kept) from jsonb_array_elements(market_ids) as kept
            where kept <> ${removed}::jsonb),
          '[null]'::jsonb)`,
        updated_at: new Date(),
      })
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where(sql<boolean>`market_ids @> jsonb_build_array(${marketId}::text)`)
      .execute();
  });
}

export function marketIds(value: unknown): MarketId[] {
  return Array.isArray(value)
    ? value.filter((id): id is MarketId => id === null || typeof id === 'string')
    : [null];
}

export async function resolveMarkets(
  db: Database,
  scope: ProjectScope,
  ids: readonly MarketId[],
): Promise<Market[]> {
  const unique = [...new Set(ids)];
  const named = unique.filter((id): id is string => id !== null);
  const rows = named.length ? await extraMarkets(db, scope).where('id', 'in', named).execute() : [];
  const found = new Map(rows.map((row) => [row.id, row]));
  const fallback = await projectDefault(db, scope);
  return unique.map((id) => {
    if (id === null) return fallback;
    const row = found.get(id);
    if (!row) throw new ApiError(422, 'Market not found for project', { code: 'market_not_found' });
    return { id, country_code: row.country_code, language_code: row.language_code };
  });
}
