/**
 * Public paths nest every resource under `/v1/projects/{project_id}`, and a
 * key restricted to one project must never reach another project's rows
 * through an ID it learned elsewhere.
 *
 * Writes need nothing here: every command finds the record it changes only in
 * the path's project (`db/workspace-scope.ts` `RecordScope`). Some read owners
 * still find a prompt set, prompt, audit, Action or crawl by workspace only, so
 * a read first proves each such path ID belongs to the path's project. Every
 * other `*_id` parameter is listed as handed to its owner with the project.
 * An unlisted one fails closed: the route answers 500 until it is listed.
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

const promptSetProject: ProjectOf = async (db, workspaceId, id) =>
  (
    await db
      .selectFrom('prompt_sets')
      .innerJoin('projects', 'projects.id', 'prompt_sets.project_id')
      .select('projects.id as project_id')
      .where('prompt_sets.id', '=', id)
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

/** The owner receives the path project and finds the record only in it. */
const BY_OWNER = 'owner';

const OWNERS: Readonly<Record<string, { resource: string; project: ProjectOf } | typeof BY_OWNER>> =
  {
    prompt_set_id: { resource: 'Prompt set', project: promptSetProject },
    prompt_id: { resource: 'Prompt', project: promptProject },
    audit_id: { resource: 'Audit', project: scoped('audits') },
    action_id: { resource: 'Action', project: scoped('actions') },
    crawl_id: { resource: 'Crawl', project: scoped('site_crawls') },
    topic_id: BY_OWNER,
    competitor_id: BY_OWNER,
    candidate_id: BY_OWNER,
    schedule_id: BY_OWNER,
    dataset_id: BY_OWNER,
    // An issue group is derived from its crawl and found only inside the path
    // crawl, which `crawl_id` above proves is the path project's.
    group_id: BY_OWNER,
  };

/**
 * 404 unless every owned path ID of a read belongs to `projectId`; an
 * unlisted `*_id` parameter throws on reads and writes alike.
 */
export async function requirePathOwnership(
  db: Database,
  workspaceId: string,
  projectId: string,
  params: Readonly<Record<string, string>>,
  access: 'read' | 'write',
): Promise<void> {
  const checks = Object.entries(params).flatMap(([name, raw]) => {
    if (name === 'project_id' || !name.endsWith('_id')) return [];
    const owner = Object.hasOwn(OWNERS, name) ? OWNERS[name] : undefined;
    if (owner === undefined) throw new Error(`Public path parameter ${name} has no owner`);
    const id = parseUuid(raw);
    // A malformed ID is the route's own 422; only a well-formed one is resolved.
    return owner === BY_OWNER || access === 'write' || id === null ? [] : [{ owner, id }];
  });
  const projects = await Promise.all(
    checks.map(({ owner, id }) => owner.project(db, workspaceId, id)),
  );
  const foreign = checks.find((_, index) => projects[index] !== projectId);
  if (foreign) throw notFound(foreign.owner.resource);
}
