/**
 * One tracked competitor at a time: add, rename or re-alias, remove.
 *
 * The project editor still replaces the whole list (`service.ts`); these
 * narrower writes take the same project row lock as suggestion accepts, so
 * the project ceiling and case-insensitive name uniqueness hold under
 * concurrent writers.
 */
import { randomUUID } from 'node:crypto';

import { competitorSchema } from '@citeladder/contracts/project';
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

export const competitorCreate = competitorInput.strict();
export const competitorUpdate = z.strictObject({
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
    .forUpdate()
    .executeTakeFirst();
  if (project === undefined) throw notFound('Project');
}

function competitorsOf(db: Database, projectId: string) {
  return db
    .selectFrom('competitors')
    .selectAll()
    .where('project_id', '=', projectId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
}

function refuseDuplicate(rows: readonly Selectable<Competitors>[], name: string): void {
  if (rows.some((row) => row.name.toLowerCase() === name.toLowerCase()))
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
  return (await competitorsOf(db, scope.projectId)).map((row) =>
    competitorView(scope.projectId, row),
  );
}

export function addCompetitor(
  db: Database,
  scope: ProjectScope,
  input: z.output<typeof competitorCreate>,
): Promise<Competitor> {
  return inTransaction(db, async (trx) => {
    await lockProject(trx, scope);
    const rows = await competitorsOf(trx, scope.projectId);
    refuseDuplicate(rows, input.name);
    if (rows.length >= MAX_COMPETITORS)
      throw new ApiError(409, `A project can have at most ${MAX_COMPETITORS} competitors`);
    const now = new Date();
    const row = await trx
      .insertInto('competitors')
      .values({
        id: randomUUID(),
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
    const rows = await competitorsOf(trx, scope.projectId);
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

export async function removeCompetitor(
  db: Database,
  scope: ProjectScope,
  competitorId: string,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await lockProject(trx, scope);
    const deleted = await trx
      .deleteFrom('competitors')
      .where('id', '=', competitorId)
      .where('project_id', '=', scope.projectId)
      .executeTakeFirst();
    if (Number(deleted.numDeletedRows) === 0) throw notFound('Competitor');
  });
}
