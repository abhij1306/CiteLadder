import type { seedQueriesResponseSchema } from '@citeladder/contracts/project';
import type { z } from 'zod';

import { entityKey, projectEntityMatching } from '../analysis/entity-matching.ts';
import type { Database } from '../db/database.ts';
import { record, strings } from '../db/json.ts';
import { notFound } from '../errors.ts';
import { loadObservedQueries, persistedSeedSources, seedQueries } from './observed-queries.ts';

type SeedQueries = z.infer<typeof seedQueriesResponseSchema>;

export function readSeedQueries(
  db: Database,
  workspaceId: string,
  projectId: string,
): Promise<SeedQueries> {
  return db.transaction().execute(async (trx) => {
    const project = await trx
      .selectFrom('projects')
      .select(['id', 'brand_name', 'language_code'])
      .where('id', '=', projectId)
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirst();
    if (!project) throw notFound('Project');
    const scope = { workspaceId, projectId, languageCode: project.language_code };
    const sources = await persistedSeedSources(trx, scope);
    if (!sources.length) return { sources: [] };
    const topics = await trx
      .selectFrom('topics')
      .select(['id', 'name', 'description'])
      .where('project_id', '=', projectId)
      .where('workspace_id', '=', workspaceId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    const profile = await trx
      .selectFrom('brand_profiles')
      .select(['products_services', 'business_context'])
      .where('project_id', '=', projectId)
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirst();
    const brand = await trx
      .selectFrom('brands')
      .select(['id', 'name'])
      .where('project_id', '=', projectId)
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirst();
    const aliases = brand
      ? await trx
          .selectFrom('brand_aliases')
          .select('alias')
          .where('brand_id', '=', brand.id)
          .where('workspace_id', '=', workspaceId)
          .execute()
      : [];
    const competitors = (
      await trx
        .selectFrom('competitors')
        .select(['name', 'aliases'])
        .where('project_id', '=', projectId)
        .where('workspace_id', '=', workspaceId)
        .execute()
    ).map((row) => ({ name: row.name, aliases: strings(row.aliases) }));
    const matching = projectEntityMatching(
      record(profile?.business_context),
      strings(profile?.products_services),
      [
        { name: brand?.name ?? project.brand_name, aliases: aliases.map((row) => row.alias) },
        ...competitors,
      ],
    );
    const observed = await loadObservedQueries(trx, {
      ...scope,
      topics,
      competitors: competitors.map((row) => ({
        aliases: [row.name, ...row.aliases],
        rule: matching[entityKey(row.name)],
      })),
    });
    return {
      sources: sources.map((source) => ({
        source,
        queries: seedQueries(observed, { seed_source: source, seed_query_ids: [] }).map(
          ({ id, text, topic_id }) => ({ id, text, topic_id }),
        ),
      })),
    };
  });
}
