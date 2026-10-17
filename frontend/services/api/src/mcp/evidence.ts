/** Project reads over the prompt, Action, demand, commerce and research owners. */
import { sql } from 'kysely';
import { policy } from '../config.ts';
import { groundedSql } from '../prompts/observed-queries.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { strings } from '../db/json.ts';
import { isoDateText, utcText } from '../db/timestamps.ts';
import { parseUuid } from '../http/uuid.ts';
import { readProjectReadiness } from '../integrations/readiness.ts';
import { getAction, listActions } from '../opportunities/actions.ts';
import { listDifferentiationReports } from '../source-pages/differentiation-reads.ts';
import { catalog, shelf } from '../commerce/reads.ts';
import { readiness, datasetPage } from '../search-intelligence/reads.ts';
import { mcpPolicy } from './config.ts';
import { appLink } from './links.ts';
import { decodeCursor, encodeCursor, pagination, reference, unavailable } from './data.ts';
import { McpInputError, type Evidence, type ProjectRead } from './types.ts';

type Page = { cursor?: string | null; limit?: number | null };
const AGGREGATE_KINDS = new Set<string>([
  'backlink_summary',
  'referring_domains',
  'destination_pages',
]);

export async function demandSnapshot({ db, scope }: ProjectRead): Promise<Evidence> {
  const row = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'demand_snapshots')
    .selectAll()
    .select([
      isoDateText(sql.ref('window_start')).as('start'),
      isoDateText(sql.ref('window_end')).as('end'),
    ])
    .where('project_id', '=', scope.projectId)
    .orderBy('window_end', 'desc')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (!row) return unavailable('no_demand_snapshot');
  return {
    state: 'available',
    window: { start: row.start, end: row.end },
    summary: row.summary,
    coverage: row.coverage,
    comparison: row.comparison,
    artifact_refs: [reference('demand_snapshot', row.id)],
  };
}

/** Active Actions in the owner's priority order, or one Action with its outcome. */
export async function actionsRead(
  { db, scope, origin }: ProjectRead,
  args: Page & { action_id?: string | null; status?: string | null },
): Promise<Evidence> {
  if (args.action_id) {
    const action = await getAction(db, scope.workspaceId, args.action_id);
    if (action.project_id !== scope.projectId)
      throw new McpInputError('Action was not found in this project');
    return {
      state: 'available',
      action: { ...action, link: appLink(origin, `/agent/actions/${action.id}`, scope.projectId) },
      artifact_refs: [reference('action', action.id)],
    };
  }
  const page = await listActions(db, scope, {
    status: args.status ?? null,
    target_kind: null,
    cursor: args.cursor ?? null,
    limit: args.limit ?? policy.opportunity.actions.ACTION_LIST_DEFAULT_LIMIT,
  });
  const items = page.items.map((item) => ({
    ...item,
    link: appLink(origin, `/agent/actions/${item.id}`, scope.projectId),
  }));
  return {
    state: 'available',
    items,
    status_counts: page.status_counts,
    pagination: pagination(items, page.next_cursor),
    artifact_refs: items.map((item) => reference('action', item.id)),
  };
}

export async function differentiationRead({ db, scope }: ProjectRead): Promise<Evidence> {
  const items = await listDifferentiationReports(
    db,
    scope,
    policy.agent.differentiation_report_limit,
  );
  return { state: 'available', items };
}

/** Without a target, the catalog to choose from; with one, its persisted shelf. */
export async function shelfRead(
  { db, scope }: ProjectRead,
  args: { target_kind?: 'category' | 'product' | null; target_id?: string | null },
): Promise<Evidence> {
  if (args.target_kind && args.target_id)
    return {
      state: 'available',
      ...(await shelf(db, scope, { kind: args.target_kind, id: args.target_id })),
    };
  if (args.target_kind || args.target_id)
    throw new McpInputError('target_kind and target_id are given together');
  const { products, categories, projection } = await catalog(db, scope);
  if (!projection.applies && !products.length) return unavailable('no_product_catalog');
  const shown = products.slice(0, mcpPolicy.max_list_limit);
  return {
    state: 'available',
    categories: categories.map(({ id, name, product_count }) => ({ id, name, product_count })),
    products: shown.map(({ id, name, brand, canonical_url, category_ids }) => ({
      id,
      name,
      brand,
      url: canonical_url,
      category_ids,
    })),
    products_omitted: products.length - shown.length,
  };
}

export function integrationStatus({ db, scope }: ProjectRead): Promise<Evidence> {
  return readProjectReadiness(db, scope);
}

export async function promptPortfolio(
  { db, scope }: ProjectRead,
  args: Page & {
    prompt_set_id?: string | null;
    cohort?: string | null;
    active_only?: boolean;
  },
): Promise<Evidence> {
  let query = new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'projects')
    .innerJoin('prompt_sets as s', 's.project_id', 'projects.id')
    .innerJoin('prompts as p', 'p.prompt_set_id', 's.id')
    .leftJoin('topics as t', 't.id', 'p.topic_id')
    .select([
      'p.id',
      'p.prompt_set_id',
      's.name as prompt_set_name',
      't.name as topic',
      'p.text',
      'p.intent',
      'p.buyer_stage',
      'p.prompt_intent',
      'p.cohort',
      'p.enabled',
      'p.status',
      'p.origin',
      'p.created_at',
    ])
    .select(utcText(sql.ref('p.created_at')).as('cursor_at'))
    // Whether the project's own searches informed the wording; never the queries.
    .select(groundedSql(sql`p.generation_evidence->'evidence_refs'`).as('grounded'))
    .where('projects.id', '=', scope.projectId);
  if (args.prompt_set_id) query = query.where('s.id', '=', args.prompt_set_id);
  if (args.active_only)
    query = query.where('p.enabled', '=', true).where('p.status', '=', 'active');
  if (args.cohort) query = query.where('p.cohort', '=', args.cohort);
  // A cursor continues only the selection that produced it.
  const filters = JSON.stringify([
    args.prompt_set_id ?? null,
    args.cohort ?? null,
    !!args.active_only,
  ]);
  if (args.cursor) {
    const [key, at, id] = decodeCursor(args.cursor, 3);
    if (key !== filters || !at || Number.isNaN(Date.parse(at)) || !parseUuid(id))
      throw new McpInputError('cursor is invalid for this selection');
    query = query.where(sql<boolean>`(p.created_at,p.id) > (${at}::timestamptz,${id}::uuid)`);
  }
  const count = args.limit ?? mcpPolicy.default_list_limit;
  const rows = await query
    .orderBy('p.created_at')
    .orderBy('p.id')
    .limit(count + 1)
    .execute();
  const selected = rows.slice(0, count);
  const last = selected.at(-1);
  const items = selected.map(({ enabled, cursor_at: _at, ...row }) => ({
    ...row,
    active: enabled && row.status === 'active',
    record_uri: `citeladder://prompt/${row.id}`,
  }));
  return {
    state: 'available',
    items,
    pagination: pagination(
      items,
      rows.length > count && last ? encodeCursor(filters, last.cursor_at, last.id) : null,
    ),
  };
}

export async function searchIntelligence({ db, scope }: ProjectRead): Promise<Evidence> {
  const result = await readiness(db, {
    workspace: new WorkspaceScope(scope.workspaceId),
    projectId: scope.projectId,
  });
  const datasets = result.datasets.map((row) => ({
    ...row,
    record_uri: `citeladder://search_dataset/${row.id}`,
    aggregate_not_individual_links: AGGREGATE_KINDS.has(row.dataset_kind),
  }));
  return {
    state: datasets.length ? 'available' : 'unavailable',
    connected: result.connected,
    owned_targets: result.owned_targets,
    competitors: result.competitors,
    latest_run: result.latest_run,
    datasets,
    artifact_refs: datasets.map((row) => reference('search_dataset', row.id)),
  };
}

export async function searchDataset(
  { db, scope }: ProjectRead,
  args: Page & { dataset_id: string; sort?: string | null; direction: 'asc' | 'desc' },
): Promise<Evidence> {
  const page = await datasetPage(
    db,
    { workspace: new WorkspaceScope(scope.workspaceId), projectId: scope.projectId },
    args.dataset_id,
    {
      cursor: args.cursor ?? null,
      limit: args.limit ?? mcpPolicy.default_list_limit,
      sort: args.sort ?? 'id',
      direction: args.direction,
      search: '',
      minVolume: null,
      intent: '',
    },
  );
  const items = page.rows.map((row) => ({
    ...row,
    record_uri: `citeladder://search_row/${row.id}`,
  }));
  return {
    state: 'available',
    dataset: page.dataset,
    aggregate_not_individual_links: AGGREGATE_KINDS.has(page.dataset.dataset_kind),
    items,
    pagination: pagination(items, page.next_cursor, page.dataset.filtered_saved_count ?? null),
    artifact_refs: [reference('search_dataset', page.dataset.id)],
  };
}

/** Competitor names and domains for the overview; IDs stay internal. */
export async function competitorsAndDomains({ db, scope }: ProjectRead) {
  const workspace = new WorkspaceScope(scope.workspaceId);
  // Neither table carries a workspace; the owning project scopes them.
  const project = () =>
    workspace.selectFrom(db, 'projects').where('projects.id', '=', scope.projectId);
  const [owned, competitors] = await Promise.all([
    project()
      .innerJoin('owned_domains as d', 'd.project_id', 'projects.id')
      .select('d.domain')
      .orderBy('d.domain')
      .execute(),
    project()
      .innerJoin('competitors as c', 'c.project_id', 'projects.id')
      .select(['c.name', 'c.aliases', 'c.domains'])
      .orderBy('c.name')
      .execute(),
  ]);
  return {
    owned_domains: owned.map((row) => row.domain),
    competitors: competitors.map((row) => ({
      name: row.name,
      aliases: strings(row.aliases),
      domains: strings(row.domains),
    })),
  };
}
