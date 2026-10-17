/**
 * Public paths nest every resource under `/v1/projects/{project_id}`. The
 * browser owners scope a prompt, topic, audit, action or crawl by workspace
 * only, so a public request first proves each such path ID belongs to the
 * path's project: a key restricted to one project can never reach another
 * project's rows through an ID it learned elsewhere.
 */
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import { parseUuid } from '../http/uuid.ts';

type ProjectOf = (db: Database, workspaceId: string, id: string) => Promise<string | undefined>;

/** A table carrying `workspace_id` and `project_id` itself. */
const scoped =
  (table: 'audits' | 'actions' | 'site_crawls'): ProjectOf =>
  async (db, workspaceId, id) =>
    (
      await db
        .selectFrom(table)
        .select('project_id')
        .where('id', '=', id)
        .where('workspace_id', '=', workspaceId)
        .executeTakeFirst()
    )?.project_id;

/** A table carrying `project_id` only; the workspace comes from the project. */
const viaProject =
  (table: 'prompt_sets' | 'topics'): ProjectOf =>
  async (db, workspaceId, id) =>
    (
      await db
        .selectFrom(table)
        .innerJoin('projects', 'projects.id', `${table}.project_id`)
        .select('projects.id as project_id')
        .where(`${table}.id`, '=', id)
        .where('projects.workspace_id', '=', workspaceId)
        .executeTakeFirst()
    )?.project_id;

const promptProject: ProjectOf = async (db, workspaceId, id) =>
  (
    await db
      .selectFrom('prompts')
      .innerJoin('prompt_sets', 'prompt_sets.id', 'prompts.prompt_set_id')
      .innerJoin('projects', 'projects.id', 'prompt_sets.project_id')
      .select('projects.id as project_id')
      .where('prompts.id', '=', id)
      .where('projects.workspace_id', '=', workspaceId)
      .executeTakeFirst()
  )?.project_id;

const OWNERS: Readonly<Record<string, { resource: string; project: ProjectOf }>> = {
  prompt_set_id: { resource: 'Prompt set', project: viaProject('prompt_sets') },
  topic_id: { resource: 'Topic', project: viaProject('topics') },
  prompt_id: { resource: 'Prompt', project: promptProject },
  audit_id: { resource: 'Audit', project: scoped('audits') },
  action_id: { resource: 'Action', project: scoped('actions') },
  crawl_id: { resource: 'Crawl', project: scoped('site_crawls') },
};

/** 404 unless every owned path ID belongs to `projectId`. */
export async function requirePathOwnership(
  db: Database,
  workspaceId: string,
  projectId: string,
  params: Readonly<Record<string, string>>,
): Promise<void> {
  const checks = Object.entries(params).flatMap(([name, raw]) => {
    const owner = Object.hasOwn(OWNERS, name) ? OWNERS[name] : undefined;
    const id = parseUuid(raw);
    // A malformed ID is the route's own 422; only a well-formed one is resolved.
    return owner === undefined || id === null ? [] : [{ owner, id }];
  });
  const projects = await Promise.all(
    checks.map(({ owner, id }) => owner.project(db, workspaceId, id)),
  );
  const foreign = checks.find((_, index) => projects[index] !== projectId);
  if (foreign) throw notFound(foreign.owner.resource);
}
