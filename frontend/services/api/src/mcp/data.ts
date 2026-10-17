/** Live authorization for persisted MCP evidence. */
import { sql, type RawBuilder } from 'kysely';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { parseUuid } from '../http/uuid.ts';
import { utcText } from '../db/timestamps.ts';
import { strings } from '../db/json.ts';
import type { Actor } from '../auth/actor.ts';
import {
  McpInputError,
  type Evidence,
  type EvidencePrincipal,
  type McpPrincipal,
} from './types.ts';
import { holdsWrite, mcpPolicy } from './config.ts';
import { rolesWith } from '../auth/workspace.ts';
import { effectiveStatus } from '../opportunities/action-status.ts';
import { appLink, recordPath } from './links.ts';
import { containsPattern } from '../db/like.ts';

// A tool call that authorizes several reads checks grant and membership once.
// Only a principal minted for one call shares its check; any other is live.
const perCall = new WeakMap<EvidencePrincipal, Promise<string[]> | null>();
export function principalForCall(principal: EvidencePrincipal): EvidencePrincipal {
  const call = { ...principal };
  perCall.set(call, null);
  return call;
}
export function authorizedWorkspaceIds(
  db: Database,
  principal: EvidencePrincipal,
): Promise<string[]> {
  if (!perCall.has(principal)) return liveWorkspaceIds(db, principal);
  let result = perCall.get(principal);
  if (!result) {
    result = liveWorkspaceIds(db, principal);
    perCall.set(principal, result);
    result.catch(() => perCall.set(principal, null));
  }
  return result;
}
async function liveWorkspaceIds(db: Database, principal: EvidencePrincipal): Promise<string[]> {
  const identity = await db
    .selectFrom('users')
    .selectAll()
    .where('id', '=', principal.userId)
    .executeTakeFirst();
  if (!identity?.is_active) return [];
  if ('kind' in principal) {
    const member = await db
      .selectFrom('workspace_members as m')
      .innerJoin('workspaces as w', 'w.id', 'm.workspace_id')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select('m.workspace_id')
      .where('m.user_id', '=', principal.userId)
      .where('m.workspace_id', '=', principal.workspaceId)
      .where('m.role', 'in', rolesWith('read'))
      .where('w.is_system', '=', false)
      .where('u.is_active', '=', true)
      .executeTakeFirst();
    return member ? [member.workspace_id] : [];
  }
  const rows = await db
    .selectFrom('workspace_members as member')
    .innerJoin('workspaces as workspace', 'workspace.id', 'member.workspace_id')
    .innerJoin('mcp_oauth_grants as g', 'g.user_id', 'member.user_id')
    .innerJoin('users as account', 'account.id', 'member.user_id')
    .select('member.workspace_id')
    .where('member.user_id', '=', principal.userId)
    .where('member.role', 'in', rolesWith('read'))
    .where('workspace.is_system', '=', false)
    .where('account.is_active', '=', true)
    .where('g.id', '=', principal.grantId)
    .where('g.access_token_hash', '=', principal.tokenHash)
    .where('g.revoked_at', 'is', null)
    .where('g.access_expires_at', '>', sql<Date>`clock_timestamp()`)
    .where(sql<boolean>`g.workspace_ids @> jsonb_build_array(member.workspace_id::text)`)
    .execute();
  return rows.map((row) => row.workspace_id);
}
export async function authorizeProject(
  db: Database,
  principal: EvidencePrincipal,
  projectId: string,
) {
  const id = parseUuid(projectId);
  if (!id) throw new McpInputError('project_id must be a UUID');
  // A pinned caller learns no more about a sibling project than about a missing one.
  if ('kind' in principal && principal.projectId !== id)
    throw new McpInputError('Project was not found in this account');
  const workspaces = await authorizedWorkspaceIds(db, principal);
  const row = workspaces.length
    ? await db
        .selectFrom('projects')
        .selectAll()
        .where('id', '=', id)
        .where('workspace_id', 'in', workspaces)
        .executeTakeFirst()
    : undefined;
  if (!row) throw new McpInputError('Project was not found in this account');
  return row;
}
/**
 * The member's actor for a change in the project's workspace. The grant must
 * hold write; the live role, read here, decides what each command allows.
 */
export async function writeActor(
  db: Database,
  principal: McpPrincipal,
  projectId: string,
): Promise<Actor> {
  if (!principal.canWrite)
    throw new McpInputError(
      'This connection can only read. Reconnect CiteLadder and tick Allow changes to make changes.',
    );
  const project = await authorizeProject(db, principal, projectId);
  // Shared until commit: a revocation, scope change or demotion waits for, or
  // precedes, the change.
  const grant = await db
    .selectFrom('mcp_oauth_grants')
    .select('scopes')
    .where('id', '=', principal.grantId)
    .where('access_token_hash', '=', principal.tokenHash)
    .where('revoked_at', 'is', null)
    .forShare()
    .executeTakeFirst();
  if (!grant) throw new McpInputError('Project was not found in this account');
  if (!holdsWrite(strings(grant.scopes)))
    throw new McpInputError(
      'This connection can only read. Reconnect CiteLadder and tick Allow changes to make changes.',
    );
  const member = await db
    .selectFrom('workspace_members')
    .select('role')
    .where('user_id', '=', principal.userId)
    .where('workspace_id', '=', project.workspace_id)
    .forShare()
    .executeTakeFirst();
  if (!member) throw new McpInputError('Project was not found in this account');
  return {
    kind: 'mcp',
    workspaceId: project.workspace_id,
    userId: principal.userId,
    role: member.role,
    scopes: 'all',
  };
}
export const encodeCursor = (...parts: unknown[]) =>
  Buffer.from(JSON.stringify(parts.map(String))).toString('base64url');
export function decodeCursor(value: string, size: number): string[] {
  try {
    const parts: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !Array.isArray(parts) ||
      parts.length !== size ||
      parts.some((part) => typeof part !== 'string')
    )
      throw new Error('cursor shape');
    return parts as string[];
  } catch {
    throw new McpInputError('cursor is invalid');
  }
}
/** A record a later `fetch` can resolve; the Agent derives a turn's sources from these. */
export const reference = (kind: string, id: string) => ({
  kind,
  id,
  record_uri: `citeladder://${kind}/${id}`,
});
/** Evidence that does not exist yet: never zero, never repaired by reading it. */
export const unavailable = (reason: string): Evidence => ({
  state: 'unavailable',
  reason,
  artifact_refs: [],
});
export const pagination = (
  items: unknown[],
  cursor: string | null,
  total: number | null = null,
) => ({
  returned_count: items.length,
  has_more: cursor !== null,
  next_cursor: cursor,
  total_count: total,
});
export async function listAccountProjects(
  db: Database,
  principal: EvidencePrincipal,
  limit: number,
  cursor: string | null,
) {
  const workspaces = await authorizedWorkspaceIds(db, principal);
  if (!workspaces.length)
    return { scope: 'account', projects: [], pagination: pagination([], null) };
  let query = db
    .selectFrom('projects as p')
    .innerJoin('workspaces as w', 'w.id', 'p.workspace_id')
    .select([
      'p.id',
      'p.workspace_id',
      'w.name as workspace_name',
      'p.name',
      'p.brand_name',
      'p.website_url',
      'p.industry',
      'p.primary_market',
    ])
    .select(utcText(sql.ref('p.created_at')).as('cursor_at'))
    .where('p.workspace_id', 'in', workspaces);
  if ('kind' in principal) query = query.where('p.id', '=', principal.projectId);
  if (cursor) {
    const [at, id] = decodeCursor(cursor, 2);
    if (!parseUuid(id) || !at || Number.isNaN(Date.parse(at)))
      throw new McpInputError('cursor is invalid');
    query = query.where(sql<boolean>`(p.created_at, p.id) > (${at}::timestamptz, ${id}::uuid)`);
  }
  const rows = await query
    .orderBy('p.created_at')
    .orderBy('p.id')
    .limit(limit + 1)
    .execute();
  const selected = rows.slice(0, limit),
    last = selected.at(-1);
  const projects = selected.map(({ cursor_at: _at, ...row }) => row);
  return {
    scope: 'account',
    projects,
    pagination: pagination(
      projects,
      rows.length > limit && last ? encodeCursor(last.cursor_at, last.id) : null,
    ),
  };
}
type SearchContext = {
  db: Database;
  workspaces: string[];
  projectId: string | null;
  limit: number;
  results: Record<string, string>[];
  like: (column: string) => RawBuilder<boolean>;
  append: (kind: string, id: string, project: string, title: string, text: string) => unknown;
};
async function searchProjects({ db, workspaces, projectId, limit, like, append }: SearchContext) {
  let projects = db
    .selectFrom('projects')
    .select(['id', 'name', 'brand_name', 'website_url'])
    .where('workspace_id', 'in', workspaces)
    .where((eb) =>
      eb.or([like('name'), like('brand_name'), like('website_url'), like('industry')]),
    );
  if (projectId) projects = projects.where('id', '=', projectId);
  for (const row of await projects.orderBy('name').orderBy('id').limit(limit).execute())
    append('project', row.id, row.id, row.name, `${row.brand_name} — ${row.website_url}`);
}
async function searchActions({
  db,
  workspaces,
  projectId,
  limit,
  results,
  like,
  append,
}: SearchContext) {
  // Active Actions only: dismissed and finished work is not a current lead.
  let actions = db
    .selectFrom('actions')
    .select(['id', 'project_id', 'target_label', 'approach'])
    .where('workspace_id', 'in', workspaces)
    .where(effectiveStatus(), 'in', policy.opportunity.actions.ACTION_ACTIVE_STATUSES)
    .where((eb) => eb.or([like('target_label'), like('approach'), like('target_url')]));
  if (projectId) actions = actions.where('project_id', '=', projectId);
  for (const row of await actions
    .orderBy(sql`priority_score desc nulls last`)
    .orderBy('id')
    .limit(limit - results.length)
    .execute())
    append('action', row.id, row.project_id, row.target_label || 'Action', row.approach ?? '');
}
async function searchPrompts({
  db,
  workspaces,
  projectId,
  limit,
  results,
  like,
  append,
}: SearchContext) {
  let prompts = db
    .selectFrom('prompts as p')
    .innerJoin('prompt_sets as s', 's.id', 'p.prompt_set_id')
    .innerJoin('projects as project', 'project.id', 's.project_id')
    .select(['p.id', 's.project_id', 'p.text', 'p.theme'])
    .where('project.workspace_id', 'in', workspaces)
    .where((eb) => eb.or([like('p.text'), like('p.theme')]));
  if (projectId) prompts = prompts.where('project.id', '=', projectId);
  for (const row of await prompts
    .orderBy('p.text')
    .orderBy('p.id')
    .limit(limit - results.length)
    .execute())
    append('prompt', row.id, row.project_id, row.theme || 'Prompt', row.text);
}
export async function searchBusinessContext(
  db: Database,
  principal: EvidencePrincipal,
  query: string,
  projectId: string | null,
  limit: number,
  origin: string,
) {
  // A pinned caller searches its own project.
  if ('kind' in principal) projectId ??= principal.projectId;
  const normalized = query.trim();
  if (!normalized) throw new McpInputError('query must not be empty');
  if (projectId) await authorizeProject(db, principal, projectId);
  const workspaces = await authorizedWorkspaceIds(db, principal);
  const results: Record<string, string>[] = [];
  if (!workspaces.length) return { query: normalized, results };
  const pattern = containsPattern(normalized);
  const like = (column: string) => sql<boolean>`${sql.ref(column)} ilike ${pattern} escape '\\'`;
  const ctx: SearchContext = {
    db,
    workspaces,
    projectId,
    limit,
    results,
    like,
    append: (kind, id, project, title, text) =>
      results.push({
        id: `citeladder://${kind}/${id}`,
        title,
        text: text.slice(0, mcpPolicy.search_snippet_chars),
        url: appLink(origin, recordPath(kind, { id }), project),
      }),
  };
  await searchProjects(ctx);
  if (results.length < limit) await searchActions(ctx);
  if (results.length < limit) await searchPrompts(ctx);
  return { query: normalized, results };
}
