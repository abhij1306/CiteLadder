/**
 * Topics: per-project prompt categories, nested at most one level.
 *
 * Generation and Commerce also create topics, under the same project
 * advisory lock every TypeScript topic writer takes first, so a delete or a
 * re-parent never interleaves with generation's topic resolution. Names are
 * unique per project case-insensitively (`uq_topic_project_name`); deleting a
 * topic detaches its prompts.
 */
import { randomUUID } from 'node:crypto';

import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import { inTransaction, type Database } from '../db/database.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { record, strings } from '../db/json.ts';
import { ApiError, notFound } from '../errors.ts';
import type { DB } from '../generated/db-schema.ts';
import { topicLinks } from './generation-plan.ts';
import { acquireProjectLock } from './locks.ts';
import { topicView, type TopicRow, type TopicView } from './views.ts';

const P = policy.prompts;
const UNIQUE_NAME = 'uq_topic_project_name';
const DUPLICATE = 'A topic with this name already exists in the project';

const name = z.string().trim().min(1).max(P.topic_name_max_chars);
const description = z.string().max(1024);

export const topicCreate = z.object({
  name,
  description: description.default(''),
  parent_id: z.uuid().nullish(),
});
export const topicUpdate = z.object({
  name: name.nullish(),
  description: description.nullish(),
  parent_id: z.uuid().nullish(),
});
const offeringName = z.string().trim().min(1).max(policy.brand_identity.profile_product_max_chars);
/**
 * The Prompt Builder's reviewed topic plan, applied at once: proposals and new
 * topics to create (a proposal names the saved offerings it covers), existing
 * topics to rename and existing topics to delete.
 */
export const topicConfirm = z.object({
  create: z
    .array(
      z.object({
        name,
        offerings: z.array(offeringName).max(P.create_batch_max).default([]),
      }),
    )
    .max(P.create_batch_max)
    .default([]),
  rename: z
    .array(z.object({ id: z.uuid(), name }))
    .max(P.create_batch_max)
    // One final name per topic: a repeated id would apply only its first name.
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, {
      message: 'Rename each topic once',
    })
    .default([]),
  delete: z.array(z.uuid()).max(P.create_batch_max).default([]),
});
export type TopicConfirm = z.infer<typeof topicConfirm>;

async function requireProject(db: Kysely<DB>, workspaceId: string, projectId: string) {
  const project = await db
    .selectFrom('projects')
    .select('id')
    .where('id', '=', projectId)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();
  if (project === undefined) throw notFound('Project');
}

async function scopedTopic(
  db: Kysely<DB>,
  workspaceId: string,
  topicId: string,
): Promise<TopicRow> {
  const topic = await db
    .selectFrom('topics')
    .innerJoin('projects', 'projects.id', 'topics.project_id')
    .selectAll('topics')
    .where('topics.id', '=', topicId)
    .where('projects.workspace_id', '=', workspaceId)
    .executeTakeFirst();
  if (topic === undefined) throw notFound('Topic');
  return topic;
}

/** Active prompts per topic of the project, for the topics rail. */
async function activeCounts(db: Kysely<DB>, projectId: string): Promise<Map<string, number>> {
  const rows = await db
    .selectFrom('prompts')
    .innerJoin('topics', 'topics.id', 'prompts.topic_id')
    .select(['prompts.topic_id', sql<string>`count(*)`.as('count')])
    .where('topics.project_id', '=', projectId)
    .where('prompts.status', '=', P.status_active)
    .groupBy('prompts.topic_id')
    .execute();
  return new Map(rows.map((row) => [row.topic_id!, Number(row.count)]));
}

async function view(db: Kysely<DB>, topic: TopicRow): Promise<TopicView> {
  return topicView(topic, (await activeCounts(db, topic.project_id)).get(topic.id) ?? 0);
}

/**
 * Enforce same-project, depth-one nesting for a parent assignment. The caller
 * holds the project lock, so neither side gains a parent or children before
 * commit.
 */
async function validateParent(
  db: Kysely<DB>,
  projectId: string,
  parentId: string,
  topicId: string | null,
): Promise<void> {
  const parent = await db
    .selectFrom('topics')
    .select(['id', 'parent_id'])
    .where('id', '=', parentId)
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  if (parent === undefined) throw notFound('Parent topic');
  if (parent.id === topicId) throw new ApiError(422, 'A topic cannot be its own parent');
  if (parent.parent_id !== null) throw new ApiError(422, 'A subtopic cannot have subtopics');
  if (topicId === null) return;
  const child = await db
    .selectFrom('topics')
    .select('id')
    .where('parent_id', '=', topicId)
    .executeTakeFirst();
  if (child !== undefined) {
    throw new ApiError(422, 'A topic with subtopics cannot become a subtopic');
  }
}

async function writing<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error, UNIQUE_NAME)) throw new ApiError(409, DUPLICATE);
    throw error;
  }
}

export async function listTopics(
  db: Database,
  workspaceId: string,
  projectId: string,
): Promise<TopicView[]> {
  await requireProject(db, workspaceId, projectId);
  const [topics, counts] = await Promise.all([
    db
      .selectFrom('topics')
      .selectAll()
      .where('project_id', '=', projectId)
      .orderBy('name')
      .orderBy('id')
      .execute(),
    activeCounts(db, projectId),
  ]);
  return topics.map((topic) => topicView(topic, counts.get(topic.id) ?? 0));
}

export async function createTopic(
  db: Database,
  workspaceId: string,
  projectId: string,
  input: z.infer<typeof topicCreate>,
): Promise<TopicView> {
  return writing(() =>
    inTransaction(db, async (trx) => {
      await requireProject(trx, workspaceId, projectId);
      await acquireProjectLock(trx, projectId);
      const parentId = input.parent_id ?? null;
      if (parentId !== null) await validateParent(trx, projectId, parentId, null);
      const now = new Date();
      const row = await trx
        .insertInto('topics')
        .values({
          id: randomUUID(),
          project_id: projectId,
          parent_id: parentId,
          name: input.name,
          description: input.description.trim(),
          origin: P.topic_origin_manual,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return topicView(row, 0);
    }),
  );
}

export async function updateTopic(
  db: Database,
  workspaceId: string,
  topicId: string,
  input: z.infer<typeof topicUpdate>,
): Promise<TopicView> {
  return writing(() =>
    inTransaction(db, async (trx) => {
      const topic = await scopedTopic(trx, workspaceId, topicId);
      // Every topic edit changes binding vocabulary or hierarchy: serialize it
      // with the prompt writers that read them.
      await acquireProjectLock(trx, topic.project_id);
      const reparent = 'parent_id' in input;
      const parentId = input.parent_id ?? null;
      if (reparent && parentId !== null) {
        await validateParent(trx, topic.project_id, parentId, topic.id);
      }
      const row = await trx
        .updateTable('topics')
        .set({
          ...(reparent ? { parent_id: parentId } : {}),
          ...(input.name == null ? {} : { name: input.name }),
          ...(input.description == null ? {} : { description: input.description.trim() }),
          updated_at: new Date(),
        })
        .where('id', '=', topic.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return view(trx, row);
    }),
  );
}

export async function deleteTopic(
  db: Database,
  workspaceId: string,
  topicId: string,
): Promise<void> {
  await inTransaction(db, async (trx) => {
    const topic = await scopedTopic(trx, workspaceId, topicId);
    await acquireProjectLock(trx, topic.project_id);
    await trx.deleteFrom('topics').where('id', '=', topic.id).execute();
  });
}

/**
 * Records which saved offerings each topic covers in
 * `business_context.topic_offerings` (read by `topicOfferings`), and forgets
 * the links of `removed` topics. Only offerings the profile still lists are
 * kept, in its spelling. The caller holds the project lock.
 */
export async function linkTopicOfferings(
  trx: Kysely<DB>,
  scope: { workspaceId: string; projectId: string },
  change: { links: readonly { id: string; offerings: readonly string[] }[]; removed?: string[] },
  now: Date,
) {
  const profile = await trx
    .selectFrom('brand_profiles')
    .select(['id', 'business_context', 'products_services'])
    .where('project_id', '=', scope.projectId)
    .where('workspace_id', '=', scope.workspaceId)
    .forUpdate()
    .executeTakeFirst();
  if (!profile) return;
  const saved = new Map(
    strings(profile.products_services).map((offering) => [offering.toLowerCase(), offering]),
  );
  const business = record(profile.business_context);
  const links = topicLinks.parse(business.topic_offerings ?? {});
  for (const id of change.removed ?? []) delete links[id];
  for (const link of change.links) {
    const offerings = [
      ...new Set(link.offerings.flatMap((item) => saved.get(item.trim().toLowerCase()) ?? [])),
    ];
    if (offerings.length) links[link.id] = offerings;
  }
  await trx
    .updateTable('brand_profiles')
    .set({
      business_context: JSON.stringify({ ...business, topic_offerings: links }),
      updated_at: now,
    })
    .where('id', '=', profile.id)
    .execute();
}

/**
 * Apply a reviewed topic plan in one transaction under the project lock:
 * delete, then rename, then create, so a name a deleted or renamed topic
 * frees can be reused. A created proposal is `generated` and linked to the
 * offerings it covers; a topic the person added is `manual`. Returns the
 * project's topics afterwards.
 */
export async function confirmTopics(
  db: Database,
  workspaceId: string,
  projectId: string,
  input: TopicConfirm,
): Promise<TopicView[]> {
  await writing(() =>
    inTransaction(db, async (trx) => {
      await requireProject(trx, workspaceId, projectId);
      await acquireProjectLock(trx, projectId);
      const owned = new Set(
        (
          await trx.selectFrom('topics').select('id').where('project_id', '=', projectId).execute()
        ).map((row) => row.id),
      );
      const named = [...input.delete, ...input.rename.map((item) => item.id)];
      if (named.some((id) => !owned.has(id))) throw notFound('Topic');
      const now = new Date();
      if (input.delete.length)
        await trx.deleteFrom('topics').where('id', 'in', input.delete).execute();
      if (input.rename.length) {
        // The unique name index is checked row by row, so a swap or a chain of
        // renames would collide midway: park every renamed topic on its own id
        // first, then apply the final names in one statement.
        const ids = input.rename.map((item) => item.id);
        await trx
          .updateTable('topics')
          .set({ name: sql<string>`id::text` })
          .where('id', 'in', ids)
          .execute();
        const names = sql.join(
          input.rename.map((item) => sql`WHEN ${item.id}::uuid THEN ${item.name}`),
          sql` `,
        );
        await trx
          .updateTable('topics')
          .set({ name: sql<string>`CASE id ${names} END`, updated_at: now })
          .where('id', 'in', ids)
          .execute();
      }
      const created = input.create.map((item) => ({ ...item, id: randomUUID() }));
      if (created.length)
        await trx
          .insertInto('topics')
          .values(
            created.map((item) => ({
              id: item.id,
              project_id: projectId,
              parent_id: null,
              name: item.name,
              description: '',
              origin: item.offerings.length ? P.origins.generated : P.topic_origin_manual,
              created_at: now,
              updated_at: now,
            })),
          )
          .execute();
      await linkTopicOfferings(
        trx,
        { workspaceId, projectId },
        { links: created, removed: input.delete },
        now,
      );
    }),
  );
  return listTopics(db, workspaceId, projectId);
}

/**
 * Topic ids for the given names (keyed lower-case, blanks ignored), creating
 * unknown names as manual topics. The caller holds the project lock.
 */
export async function resolveTopicsByName(
  db: Kysely<DB>,
  projectId: string,
  names: readonly string[],
): Promise<Map<string, string>> {
  const wanted = new Map<string, string>();
  for (const raw of names) {
    const trimmed = raw.trim();
    if (trimmed && !wanted.has(trimmed.toLowerCase())) wanted.set(trimmed.toLowerCase(), trimmed);
  }
  if (wanted.size === 0) return new Map();
  const existing = await db
    .selectFrom('topics')
    .select(['id', 'name'])
    .where('project_id', '=', projectId)
    .execute();
  const resolved = new Map<string, string>();
  for (const topic of existing) {
    const key = topic.name.toLowerCase();
    if (wanted.has(key)) resolved.set(key, topic.id);
  }
  const now = new Date();
  const created = [...wanted].filter(([key]) => !resolved.has(key));
  if (created.length > 0) {
    const rows = await db
      .insertInto('topics')
      .values(
        created.map(([, topicName]) => ({
          id: randomUUID(),
          project_id: projectId,
          parent_id: null,
          name: topicName,
          description: '',
          origin: P.topic_origin_manual,
          created_at: now,
          updated_at: now,
        })),
      )
      .returning(['id', 'name'])
      .execute();
    for (const row of rows) resolved.set(row.name.toLowerCase(), row.id);
  }
  return resolved;
}
