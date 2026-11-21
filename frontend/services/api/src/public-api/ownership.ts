import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import { parseUuid } from '../http/uuid.ts';

type ProjectOf = (db: Database, workspaceId: string, id: string) => Promise<string | undefined>;

const scoped =
  (table: 'audits' | 'actions' | 'site_crawls' | 'site_urls'): ProjectOf =>
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

const BY_OWNER = 'owner';

const OWNERS: Readonly<Record<string, { resource: string; project: ProjectOf } | typeof BY_OWNER>> =
  {
    prompt_set_id: { resource: 'Prompt set', project: promptSetProject },
    prompt_id: { resource: 'Prompt', project: promptProject },
    audit_id: { resource: 'Audit', project: scoped('audits') },
    action_id: { resource: 'Action', project: scoped('actions') },
    crawl_id: { resource: 'Crawl', project: scoped('site_crawls') },
    site_url_id: { resource: 'URL', project: scoped('site_urls') },
    topic_id: BY_OWNER,
    competitor_id: BY_OWNER,
    candidate_id: BY_OWNER,
    schedule_id: BY_OWNER,
    dataset_id: BY_OWNER,
    group_id: BY_OWNER,
  };

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
    return owner === BY_OWNER || access === 'write' || id === null ? [] : [{ owner, id }];
  });
  const projects = await Promise.all(
    checks.map(({ owner, id }) => owner.project(db, workspaceId, id)),
  );
  const foreign = checks.find((_, index) => projects[index] !== projectId);
  if (foreign) throw notFound(foreign.owner.resource);
}
