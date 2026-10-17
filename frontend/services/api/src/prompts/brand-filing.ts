/**
 * Filing a manual or imported prompt that names the brand.
 *
 * A prompt naming the business measures recall of a name the asker already
 * gave, so it is never an organic (`core`) prompt. It files under the
 * comparison cohort when it also names a tracked competitor, otherwise under
 * the brand diagnostic, exactly as generation files its own branded rows.
 * Names count under the project's matching policy, so a common-word brand in
 * ordinary language ("target audience") does not file a prompt as branded.
 * An explicitly chosen cohort always wins.
 */
import type { promptCohortSchema } from '@citeladder/contracts/project';
import type { Kysely } from 'kysely';
import type { z } from 'zod';

import { namesEntity } from '../analysis/aliases.ts';
import { entityKey, projectEntityMatching } from '../analysis/entity-matching.ts';
import { strings } from '../db/json.ts';
import type { DB } from '../generated/db-schema.ts';

type Cohort = z.infer<typeof promptCohortSchema>;

/** The cohort a prompt without an explicit one files under. */
export type CohortFiling = (text: string) => Cohort;

export async function brandFiling(db: Kysely<DB>, projectId: string): Promise<CohortFiling> {
  const [project, brand, competitors, profile] = await Promise.all([
    db
      .selectFrom('projects')
      .select('brand_name')
      .where('id', '=', projectId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('brands')
      .select(['id', 'name'])
      .where('project_id', '=', projectId)
      .executeTakeFirst(),
    db
      .selectFrom('competitors')
      .select(['name', 'aliases'])
      .where('project_id', '=', projectId)
      .execute(),
    db
      .selectFrom('brand_profiles')
      .select(['business_context', 'products_services'])
      .where('project_id', '=', projectId)
      .executeTakeFirst(),
  ]);
  const aliases = brand
    ? (
        await db
          .selectFrom('brand_aliases')
          .select('alias')
          .where('brand_id', '=', brand.id)
          .execute()
      ).map((row) => row.alias)
    : [];
  const name = brand?.name ?? project.brand_name;
  const rivals = competitors.map((row) => ({ name: row.name, aliases: strings(row.aliases) }));
  const matching = projectEntityMatching(
    profile?.business_context,
    strings(profile?.products_services),
    [{ name, aliases }, ...rivals],
  );
  const names = [name, ...aliases].filter(Boolean);
  return (text) => {
    if (!names.length || !namesEntity(text, names, matching[entityKey(name)])) return 'core';
    const compares = rivals.some((rival) =>
      namesEntity(text, [rival.name, ...rival.aliases], matching[entityKey(rival.name)]),
    );
    return compares ? 'comparison' : 'brand_diagnostic';
  };
}
