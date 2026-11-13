/**
 * The tracked competitors' one writer: add, rename or re-alias, remove one at
 * a time, or save the project editor's whole list as a diff.
 *
 * Every write takes the same project row lock as suggestion accepts, so the
 * project ceiling and case-insensitive name uniqueness hold under concurrent
 * writers.
 */
import { randomUUID } from 'node:crypto';

import { competitorSchema } from '@citeladder/contracts/project';
import {
  competitorCreateRequestSchema,
  competitorUpdateRequestSchema,
} from '@citeladder/contracts/project-requests';
import type { Selectable } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import { inTransaction, type Database } from '../db/database.ts';
import { ApiError, notFound } from '../errors.ts';
import type { Competitors } from '../generated/db-schema.ts';
import type { ProjectScope } from './brand-profile.ts';
import { cleanList, competitorInput } from './inputs.ts';
import { competitorLogoUrl } from './logos.ts';

type Competitor = z.input<typeof competitorSchema>;

const MAX_COMPETITORS = policy.brand_identity.max_project_competitors;
const strings = z.array(z.string());

export const competitorCreate = competitorCreateRequestSchema.extend(competitorInput.shape);
export const competitorUpdate = competitorUpdateRequestSchema.extend({
  name: competitorInput.shape.name.optional(),
  aliases: competitorInput.shape.aliases.unwrap().optional(),
  domains: competitorInput.shape.domains.unwrap().optional(),
});

/** A tracked competitor on the wire. */
export function competitorView(
  projectId: string,
  row: Pick<Selectable<Competitors>, 'id' | 'name' | 'aliases' | 'domains' | 'logo_asset_id'>,
): Competitor {
  return {
    id: row.id,
    name: row.name,
    aliases: strings.parse(row.aliases),
    domains: strings.parse(row.domains),
    logo_url: row.logo_asset_id ? competitorLogoUrl(projectId, row.id) : null,
  };
}

/** The project row lock every competitor writer takes first, or 404. */
export async function lockProject(db: Database, scope: ProjectScope): Promise<void> {
  const project = await db
    .selectFrom('projects')
    .select('id')
    .where('id', '=', scope.projectId)
    .where('workspace_id', '=', scope.workspaceId)
    .forNoKeyUpdate()
    .executeTakeFirst();
  if (project === undefined) throw notFound('Project');
}

function competitorsOf(db: Database, { workspaceId, projectId }: ProjectScope) {
  return db
    .selectFrom('competitors')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('project_id', '=', projectId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function refuseDuplicate(rows: readonly { name: string }[], name: string): void {
  if (rows.some((row) => sameName(row.name, name)))
    throw new ApiError(409, 'This project already tracks a competitor with that name', {
      code: 'duplicate',
    });
}

export async function listCompetitors(db: Database, scope: ProjectScope): Promise<Competitor[]> {
  const project = await db
    .selectFrom('projects')
    .select('id')
    .where('id', '=', scope.projectId)
    .where('workspace_id', '=', scope.workspaceId)
    .executeTakeFirst();
  if (project === undefined) throw notFound('Project');
  return (await competitorsOf(db, scope)).map((row) => competitorView(scope.projectId, row));
}

export function addCompetitor(
  db: Database,
  scope: ProjectScope,
  input: z.output<typeof competitorCreate>,
): Promise<Competitor> {
  return inTransaction(db, async (trx) => {
    await lockProject(trx, scope);
    const rows = await competitorsOf(trx, scope);
    refuseDuplicate(rows, input.name);
    if (rows.length >= MAX_COMPETITORS)
      throw new ApiError(409, `A project can have at most ${MAX_COMPETITORS} competitors`);
    const now = new Date();
    const row = await trx
      .insertInto('competitors')
      .values({
        id: randomUUID(),
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        name: input.name,
        aliases: JSON.stringify(cleanList(input.aliases)),
        domains: JSON.stringify(cleanList(input.domains)),
        logo_asset_id: null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return competitorView(scope.projectId, row);
  });
}

export function updateCompetitor(
  db: Database,
  scope: ProjectScope,
  competitorId: string,
  input: z.output<typeof competitorUpdate>,
): Promise<Competitor> {
  return db.transaction().execute(async (trx) => {
    await lockProject(trx, scope);
    const rows = await competitorsOf(trx, scope);
    const current = rows.find((row) => row.id === competitorId);
    if (current === undefined) throw notFound('Competitor');
    if (input.name !== undefined)
      refuseDuplicate(
        rows.filter((row) => row.id !== competitorId),
        input.name,
      );
    const row = await trx
      .updateTable('competitors')
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.aliases === undefined
          ? {}
          : { aliases: JSON.stringify(cleanList(input.aliases)) }),
        ...(input.domains === undefined
          ? {}
          : { domains: JSON.stringify(cleanList(input.domains)) }),
        updated_at: new Date(),
      })
      .where('id', '=', current.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return competitorView(scope.projectId, row);
  });
}

/** One editor row: a tracked competitor's `id`, or none for a new one. */
export type CompetitorListItem = z.output<typeof competitorInput> & { id?: string };

/**
 * Save the editor's whole list as a diff, so a kept competitor's ID, logo and
 * creation time survive; only its name, aliases and domains change. A row
 * names its competitor by `id` (a rename) or, without one, by a tracked
 * name (case-insensitively). Other rows are added and competitors left out
 * are removed. An `id` the project does not track is a 404. Joins the
 * caller's transaction.
 */
export function saveCompetitorList(
  db: Database,
  scope: ProjectScope,
  items: readonly CompetitorListItem[],
): Promise<void> {
  return inTransaction(db, async (trx) => {
    await lockProject(trx, scope);
    items.forEach((item, index) => refuseDuplicate(items.slice(0, index), item.name));
    const rows = await competitorsOf(trx, scope);
    const claimed = new Map<CompetitorListItem, Selectable<Competitors>>();
    for (const item of items) {
      if (item.id === undefined) continue;
      const row = rows.find((candidate) => candidate.id === item.id);
      if (row === undefined) throw notFound('Competitor');
      if ([...claimed.values()].includes(row))
        throw new ApiError(422, 'Each competitor can appear once in the list');
      claimed.set(item, row);
    }
    const free = () => rows.filter((row) => ![...claimed.values()].includes(row));
    for (const item of items) {
      if (claimed.has(item)) continue;
      const row = free().find((candidate) => sameName(candidate.name, item.name));
      if (row !== undefined) claimed.set(item, row);
    }
    const removed = free().map((row) => row.id);
    if (removed.length)
      await trx
        .deleteFrom('competitors')
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .where('id', 'in', removed)
        .execute();
    const now = new Date();
    const fields = (item: CompetitorListItem) => ({
      name: item.name,
      aliases: JSON.stringify(cleanList(item.aliases)),
      domains: JSON.stringify(cleanList(item.domains)),
      updated_at: now,
    });
    for (const [item, row] of claimed)
      await trx.updateTable('competitors').set(fields(item)).where('id', '=', row.id).execute(); // NOSONAR -- One transaction connection: statements run in order.
    const added = items
      .filter((item) => !claimed.has(item))
      .map((item) => ({
        ...fields(item),
        id: randomUUID(),
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        logo_asset_id: null,
        created_at: now,
      }));
    if (added.length) await trx.insertInto('competitors').values(added).execute();
  });
}

export async function removeCompetitor(
  db: Database,
  scope: ProjectScope,
  competitorId: string,
): Promise<void> {
  await inTransaction(db, async (trx) => {
    await lockProject(trx, scope);
    const deleted = await trx
      .deleteFrom('competitors')
      .where('id', '=', competitorId)
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .executeTakeFirst();
    if (Number(deleted.numDeletedRows) === 0) throw notFound('Competitor');
  });
}
