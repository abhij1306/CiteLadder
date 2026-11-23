import { randomUUID } from 'node:crypto';

import { offeringMapSchema } from '@citeladder/contracts/project';
import type { Selectable } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { BrandProfiles, Projects } from '../generated/db-schema.ts';
import { record, strings } from '../db/json.ts';
import { entityKey, projectEntityMatching } from '../analysis/entity-matching.ts';
import { currentDemandSnapshot } from '../opportunities/sources.ts';
import type { ModelGateway } from '../models/gateway.ts';
import { loadVocabulary } from './binding.ts';
import {
  generationInvalid,
  validateSelection,
  wantedTopics,
  type GenerationInput,
} from './generation-input.ts';
import { brandTopics } from './brand-topics.ts';
import { acquireProjectLock } from './locks.ts';
import { loadObservedQueries } from './observed-queries.ts';
import { scopedPromptSet } from './prompt-sets.ts';
import { proposeTopics, type TopicProposalInput } from './topic-proposals.ts';
import { linkTopicOfferings } from './topics.ts';

export type OfferingMap = z.infer<typeof offeringMapSchema>;
const businessMap = z.object({ offerings: z.array(offeringMapSchema).default([]) });
export const offeringMaps = (business: Record<string, unknown>): OfferingMap[] =>
  businessMap.parse(business.business_map ?? {}).offerings;

export const TOPIC_NEEDED = 'Add a topic before generating prompts';
export const OFFERING_NEEDED = 'Add at least one offering before generating prompts';
const topicColumns = ['id', 'name', 'description', 'parent_id'] as const;
const promptColumns = ['id', 'topic_id', 'text', 'normalized_text_hash'] as const;
const candidateColumns = ['text', 'normalized_text_hash', 'disposition', 'jev_decision'] as const;

export async function topicProposalInput(
  trx: Database,
  scope: { workspaceId: string; projectId: string },
): Promise<TopicProposalInput> {
  const project = await trx
    .selectFrom('projects')
    .select(['brand_name'])
    .where('id', '=', scope.projectId)
    .where('workspace_id', '=', scope.workspaceId)
    .executeTakeFirstOrThrow();
  const profile = await trx
    .selectFrom('brand_profiles')
    .select(['products_services', 'business_context'])
    .where('project_id', '=', scope.projectId)
    .where('workspace_id', '=', scope.workspaceId)
    .executeTakeFirst();
  const brand = await trx
    .selectFrom('brands')
    .select(['id', 'name'])
    .where('project_id', '=', scope.projectId)
    .where('workspace_id', '=', scope.workspaceId)
    .executeTakeFirst();
  const aliases = brand
    ? await trx
        .selectFrom('brand_aliases')
        .select('alias')
        .where('brand_id', '=', brand.id)
        .where('workspace_id', '=', scope.workspaceId)
        .execute()
    : [];
  const existing = await trx
    .selectFrom('topics')
    .select('name')
    .where('project_id', '=', scope.projectId)
    .where('workspace_id', '=', scope.workspaceId)
    .execute();
  const business = record(profile?.business_context);
  return {
    offerings: strings(profile?.products_services),
    brandNames: [brand?.name ?? project.brand_name, ...aliases.map((row) => row.alias)],
    categoryTerms: [...strings(business.category_terms), ...strings(business.category_aliases)],
    existing: existing.map((row) => row.name),
    limit: policy.prompts.generation.topic_max,
  };
}

function recoveryInput(db: Database, workspaceId: string, setId: string) {
  return db.transaction().execute(async (trx) => {
    const set = await scopedPromptSet(trx, workspaceId, setId);
    const input = await topicProposalInput(trx, { workspaceId, projectId: set.project_id });
    return input.existing.length ? null : input;
  });
}

export async function recoverTopics(
  db: Database,
  scope: { workspaceId: string; setId: string },
  model: {
    gateway: () => ModelGateway;
    deadline: AbortSignal;
    reserve: () => Promise<void>;
  },
) {
  const input = await recoveryInput(db, scope.workspaceId, scope.setId);
  if (!input) return null;
  if (!input.offerings.length) throw generationInvalid(OFFERING_NEEDED);
  const gateway = model.gateway();
  await model.reserve();
  const proposal = await proposeTopics(input, gateway, model.deadline);
  return db.transaction().execute(async (trx) => {
    const set = await scopedPromptSet(trx, scope.workspaceId, scope.setId);
    await acquireProjectLock(trx, set.project_id);
    const raced = await trx
      .selectFrom('topics')
      .select('id')
      .where('project_id', '=', set.project_id)
      .executeTakeFirst();
    if (raced) return null;
    if (!proposal.topics.length)
      throw generationInvalid('No buyer-facing topic could be proposed from the offerings');
    const now = new Date();
    const created = proposal.topics.map((topic) => ({ ...topic, id: randomUUID() }));
    await trx
      .insertInto('topics')
      .values(
        created.map((topic) => ({
          id: topic.id,
          workspace_id: scope.workspaceId,
          project_id: set.project_id,
          parent_id: null,
          name: topic.name,
          description: '',
          origin: 'generated',
          created_at: now,
          updated_at: now,
        })),
      )
      .execute();
    await linkTopicOfferings(
      trx,
      { workspaceId: scope.workspaceId, projectId: set.project_id },
      { links: created },
      now,
    );
    return {
      source: proposal.source,
      model: proposal.model,
      created: proposal.topics,
      overflow: proposal.overflow,
      dropped: proposal.dropped,
    };
  });
}
export type TopicRecovery = Awaited<ReturnType<typeof recoverTopics>>;

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

async function brandIdentity(
  trx: Database,
  { workspaceId, projectId }: { workspaceId: string; projectId: string },
) {
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
  return { brand, aliases };
}

async function demandGrounding(
  trx: Database,
  { workspaceId, projectId, count }: { workspaceId: string; projectId: string; count: number },
) {
  const snapshotRef = await currentDemandSnapshot(trx, { workspaceId, projectId });
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
        .where('project_id', '=', projectId)
        .where('snapshot_id', '=', snapshot.id)
        .where('state', '=', 'active')
        .orderBy('priority_score', (order) => order.desc().nullsLast())
        .orderBy('id')
        .limit(count)
        .execute()
    : [];
  return { snapshot, demand };
}

type GenerationProfile = Pick<
  Selectable<BrandProfiles>,
  'business_context' | 'description' | 'positioning' | 'target_audience' | 'sources'
>;
type GenerationProject = Pick<
  Selectable<Projects>,
  'country_code' | 'primary_market' | 'language_code'
>;

function generationBusiness({
  profile,
  project,
  offerings,
}: {
  profile: GenerationProfile | undefined;
  project: GenerationProject;
  offerings: string[];
}) {
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
  return { persistedBusiness, business };
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
    const topics = await brandTopics(trx, { workspaceId, projectId: project.id })
      .select(topicColumns)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    validateSelection(input, topics);
    if (!topics.length) throw generationInvalid(TOPIC_NEEDED);
    const offerings = strings(profile?.products_services);
    const wanted = wantedTopics(input);
    const selected = wanted.length
      ? wanted.map((id) => topics.find((topic) => topic.id === id)!)
      : topics;
    const { brand, aliases } = await brandIdentity(trx, { workspaceId, projectId: project.id });
    const competitors = await trx
      .selectFrom('competitors')
      .select(['name', 'aliases'])
      .where('project_id', '=', project.id)
      .where('workspace_id', '=', workspaceId)
      .execute();
    const prompts = await trx
      .selectFrom('prompts')
      .select(promptColumns)
      .where('prompt_set_id', '=', setId)
      .where('workspace_id', '=', workspaceId)
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
    const { snapshot, demand } = await demandGrounding(trx, {
      workspaceId,
      projectId: project.id,
      count: input.count,
    });
    const { persistedBusiness, business } = generationBusiness({ profile, project, offerings });
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
      vocabulary: await loadVocabulary(
        trx,
        { workspaceId, projectId: project.id },
        policy.prompts.generation.generated_binding_excluded_fields,
      ),
    };
  });
}
export type GenerationContext = Awaited<ReturnType<typeof generationContext>>;
