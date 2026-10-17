import { randomUUID } from 'node:crypto';

import { offeringMapSchema } from '@citeladder/contracts/project';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record, strings } from '../db/json.ts';
import { entityKey, projectEntityMatching } from '../analysis/entity-matching.ts';
import { currentDemandSnapshot } from '../opportunities/sources.ts';
import { loadVocabulary } from './binding.ts';
import {
  generationInvalid,
  validateSelection,
  wantedTopics,
  type GenerationInput,
} from './generation-input.ts';
import { acquireProjectLock } from './locks.ts';
import { loadObservedQueries } from './observed-queries.ts';
import { scopedPromptSet } from './prompt-sets.ts';

export type OfferingMap = z.infer<typeof offeringMapSchema>;
const businessMap = z.object({ offerings: z.array(offeringMapSchema).default([]) });
/** The persisted `business_context.business_map` offerings. */
export const offeringMaps = (business: Record<string, unknown>): OfferingMap[] =>
  businessMap.parse(business.business_map ?? {}).offerings;

/** Columns generation reads; widening one is a reviewed change, not a `selectAll`. */
const topicColumns = ['id', 'name', 'description', 'parent_id'] as const;
const promptColumns = ['id', 'topic_id', 'text', 'normalized_text_hash'] as const;
const candidateColumns = ['normalized_text_hash', 'disposition', 'jev_decision'] as const;

/** A project without topics gets one generated topic per confirmed offering. */
function recoverTopics(trx: Database, projectId: string, offerings: string[]) {
  const names = new Map<string, string>();
  for (const offering of offerings) {
    const name = offering
      .trim()
      .replaceAll(/\s+/gu, ' ')
      .slice(0, policy.prompts.topic_name_max_chars)
      .trim();
    if (name) names.set(name.toLowerCase(), name);
  }
  if (!names.size)
    throw generationInvalid('Add at least one confirmed offering before generating prompts');
  const now = new Date();
  return trx
    .insertInto('topics')
    .values(
      [...names.values()].slice(0, policy.prompts.generation.topic_max).map((name) => ({
        id: randomUUID(),
        project_id: projectId,
        parent_id: null,
        name,
        description: '',
        origin: 'generated',
        created_at: now,
        updated_at: now,
      })),
    )
    .returning(topicColumns)
    .execute();
}

/** Persisted field sources, overridden by each profile field's review state. */
function fieldSources(business: Record<string, unknown>, sources: Record<string, unknown>) {
  const result = { ...record(business.field_sources) };
  for (const field of ['description', 'positioning', 'products_services', 'target_audience']) {
    const source = record(sources[field]);
    if (!Object.keys(source).length) continue;
    const reviewed = ['confirmed', 'edited'].includes(String(source.review_state));
    result[field] = reviewed ? 'reviewed' : 'inferred';
  }
  return result;
}

export function generationContext(
  db: Database,
  workspaceId: string,
  setId: string,
  input: GenerationInput,
) {
  return db.transaction().execute(async (trx) => {
    const set = await scopedPromptSet(trx, workspaceId, setId);
    await acquireProjectLock(trx, set.project_id);
    await scopedPromptSet(trx, workspaceId, setId);
    const project = await trx
      .selectFrom('projects')
      .select(['id', 'brand_name', 'country_code', 'primary_market', 'language_code'])
      .where('id', '=', set.project_id)
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirstOrThrow();
    const profile = await trx
      .selectFrom('brand_profiles')
      .select([
        'products_services',
        'business_context',
        'description',
        'positioning',
        'target_audience',
        'sources',
        'source_artifact_ids',
      ])
      .where('project_id', '=', project.id)
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirst();
    let topics = await trx
      .selectFrom('topics')
      .select(topicColumns)
      .where('project_id', '=', project.id)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    validateSelection(input, topics);
    const offerings = strings(profile?.products_services);
    if (!topics.length) topics = await recoverTopics(trx, project.id, offerings);
    const wanted = wantedTopics(input);
    const selected = wanted.length
      ? wanted.map((id) => topics.find((topic) => topic.id === id)!)
      : topics;
    const brand = await trx
      .selectFrom('brands')
      .select(['id', 'name'])
      .where('project_id', '=', project.id)
      .executeTakeFirst();
    const aliases = brand
      ? await trx
          .selectFrom('brand_aliases')
          .select('alias')
          .where('brand_id', '=', brand.id)
          .execute()
      : [];
    const competitors = await trx
      .selectFrom('competitors')
      .select(['name', 'aliases'])
      .where('project_id', '=', project.id)
      .execute();
    const prompts = await trx
      .selectFrom('prompts')
      .select(promptColumns)
      .where('prompt_set_id', '=', setId)
      // Oldest first: model and judge context keep the most recent texts.
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    const candidates = await trx
      .selectFrom('prompt_candidates')
      .select(candidateColumns)
      .where('workspace_id', '=', workspaceId)
      .where('prompt_set_id', '=', setId)
      .where('expires_at', '>', new Date())
      .execute();
    const snapshotRef = await currentDemandSnapshot(trx, { workspaceId, projectId: project.id });
    const snapshot = snapshotRef
      ? await trx
          .selectFrom('demand_snapshots')
          .select(['id', 'coverage', 'window_start', 'window_end'])
          .where('id', '=', snapshotRef.id)
          .where('workspace_id', '=', workspaceId)
          .executeTakeFirstOrThrow()
      : null;
    const demand = snapshot
      ? await trx
          .selectFrom('demand_signals')
          .select([
            'id',
            'signal_type',
            'topic_cluster',
            'page_url',
            'priority_score',
            'limitations',
            'evidence',
            'metrics',
          ])
          .where('workspace_id', '=', workspaceId)
          .where('project_id', '=', project.id)
          .where('snapshot_id', '=', snapshot.id)
          .where('state', '=', 'active')
          .orderBy('priority_score', (order) => order.desc().nullsLast())
          .orderBy('id')
          .limit(input.count)
          .execute()
      : [];
    const persistedBusiness = record(profile?.business_context);
    const business = {
      ...persistedBusiness,
      products_services: offerings,
      description: profile?.description ?? '',
      positioning: profile?.positioning ?? '',
      target_audience: profile?.target_audience ?? '',
      primary_market: project.country_code || project.primary_market,
      language_code: project.language_code,
      field_sources: fieldSources(persistedBusiness, record(profile?.sources)),
    };
    const maps = offeringMaps(business);
    const context = {
      brand_name: brand?.name ?? project.brand_name,
      brand_aliases: aliases.map((row) => row.alias),
      competitors: competitors.map((row) => ({ name: row.name, aliases: strings(row.aliases) })),
      country_code: project.country_code,
      language_code: project.language_code,
      business_context: business,
      knowledge_base: {
        description: profile?.description ?? '',
        positioning: profile?.positioning ?? '',
        products_services: offerings,
        target_audience: profile?.target_audience ?? '',
        sources: record(profile?.sources),
        source_artifact_ids: record(profile?.source_artifact_ids),
      },
      demand_signals: demand.map((row) => ({
        id: row.id,
        type: row.signal_type,
        topic: row.topic_cluster,
        page: row.page_url,
        priority: row.priority_score,
        limitations: row.limitations,
        ...(record(row.evidence).target_kind === 'query'
          ? { observed_query: record(row.evidence).target }
          : {}),
        observed_metrics: row.metrics,
        observed_period: snapshot
          ? { start: snapshot.window_start, end: snapshot.window_end }
          : null,
      })),
    };
    const matching = projectEntityMatching(persistedBusiness, offerings, [
      { name: context.brand_name, aliases: context.brand_aliases },
      ...context.competitors,
    ]);
    const revision = input.agent_revision_id
      ? await trx
          .selectFrom('agent_output_revisions as revision')
          .innerJoin('agent_outputs as output', 'output.id', 'revision.output_id')
          .select([
            'revision.id',
            'revision.output_id',
            'revision.run_id',
            'revision.source_refs',
            'revision.body',
          ])
          .where('revision.id', '=', input.agent_revision_id)
          .where('revision.workspace_id', '=', workspaceId)
          .where('revision.project_id', '=', project.id)
          .where('output.workspace_id', '=', workspaceId)
          .where('output.project_id', '=', project.id)
          .where('output.kind', '=', 'prompt_portfolio')
          .executeTakeFirst()
      : null;
    if (input.agent_revision_id && !revision)
      throw generationInvalid('Portfolio revision is unavailable in this project');
    // Persisted search data only: grounding never fetches, and an empty result
    // leaves generation exactly as it is without it.
    const observed = await loadObservedQueries(trx, {
      workspaceId,
      projectId: project.id,
      languageCode: project.language_code,
      topics,
      competitors: context.competitors.map((row) => ({
        aliases: [row.name, ...row.aliases],
        rule: matching[entityKey(row.name)],
      })),
    });
    return {
      set,
      project,
      topics,
      selected,
      offerings,
      maps,
      context,
      matching,
      prompts,
      candidates,
      snapshot,
      demand,
      observed,
      revision,
      vocabulary: await loadVocabulary(
        trx,
        project.id,
        policy.prompts.generation.generated_binding_excluded_fields,
      ),
    };
  });
}
export type GenerationContext = Awaited<ReturnType<typeof generationContext>>;
