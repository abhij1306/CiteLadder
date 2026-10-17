/**
 * Persisted Search Intelligence reads: readiness, runs, dataset rows and the
 * evidence handed to content work. Reads render what acquisition published;
 * none of them resolves a website or calls DataForSEO.
 */
import { asApiErrorCode } from '@citeladder/contracts/error-codes';
import type { searchReadinessSchema } from '@citeladder/contracts/search-intelligence';
import { sql, type NotNull, type RawBuilder, type SqlBool } from 'kysely';
import { z } from 'zod';

import type { WorkspaceScope } from '../db/workspace-scope.ts';
import type { Database } from '../db/database.ts';
import { strings } from '../db/json.ts';
import { ApiError, notFound } from '../errors.ts';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../http/keyset-cursor.ts';
import { containsPattern } from '../db/like.ts';
import { parseUuid } from '../http/uuid.ts';
import { policy } from '../config.ts';
import { preferencesBody } from '../routes/search-intelligence-contracts.ts';
import { competitorTarget, ownedTargets, searchMarket } from './targets.ts';
import { datasetView, rowView, runView } from './views.ts';
import { isNonEmpty, lastOf, onlyOf } from '../lists.ts';
import { workspaceConnections } from './credentials.ts';

const si = policy.search_intelligence;
const ROW_SORT_FIELDS = new Set<string>(si.row_sort_fields);
const AUXILIARY_SORT_FIELDS = new Set<string>(si.auxiliary_sort_fields);
const SEARCHED_COLUMNS = ['keyword', 'domain', 'url', 'intent'] as const;
const PUBLISHED = 'published';
const savedDomains = z.array(z.string());

export type Scope = { workspace: WorkspaceScope; projectId: string };

/** A published dataset of the project; one still collecting is not evidence yet. */
async function publishedDataset(db: Database, scope: Scope, datasetId: string) {
  const dataset = await scope.workspace
    .selectFrom(db, 'search_intelligence_datasets')
    .selectAll()
    .where('project_id', '=', scope.projectId)
    .where('id', '=', datasetId)
    .where('status', '=', PUBLISHED)
    .executeTakeFirst();
  if (dataset === undefined) throw notFound('Dataset');
  return dataset;
}

/** Whether a review can run: on the workspace's one eligible connection (none or several need the user to fix it). */
async function researchAccount(db: Database, workspace: WorkspaceScope) {
  const connection = onlyOf(await workspaceConnections(db, workspace)) ?? null;
  return {
    connected: connection !== null,
    connection_id: connection?.id ?? null,
  };
}

export async function readiness(
  db: Database,
  scope: Scope,
): Promise<z.input<typeof searchReadinessSchema>> {
  const project = await scope.workspace
    .selectFrom(db, 'projects')
    .select([
      'name',
      'website_url',
      'language_code',
      'serp_language_code',
      'serp_location_code',
      'search_intelligence_preferences',
    ])
    .where('id', '=', scope.projectId)
    .executeTakeFirst();
  if (project === undefined) throw notFound('Project');
  const [ownedDomains, competitors, account, latest, datasets] = await Promise.all([
    // Project children carry no workspace column; the join scopes them.
    scope.workspace
      .selectFrom(db, 'projects')
      .innerJoin('owned_domains', 'owned_domains.project_id', 'projects.id')
      .select(['owned_domains.id', 'owned_domains.domain'])
      .where('projects.id', '=', scope.projectId)
      .orderBy('owned_domains.created_at')
      .orderBy('owned_domains.id')
      .execute(),
    scope.workspace
      .selectFrom(db, 'projects')
      .innerJoin('competitors', 'competitors.project_id', 'projects.id')
      .select(['competitors.id', 'competitors.name', 'competitors.domains'])
      .where('projects.id', '=', scope.projectId)
      .orderBy('competitors.created_at')
      .orderBy('competitors.id')
      .execute(),
    researchAccount(db, scope.workspace),
    // An unconfirmed cost review is a draft, never the acquisition the screen follows.
    scope.workspace
      .selectFrom(db, 'search_intelligence_runs')
      .selectAll()
      .where('project_id', '=', scope.projectId)
      .where('confirmed_at', 'is not', null)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst(),
    scope.workspace
      .selectFrom(db, 'search_intelligence_datasets')
      .selectAll()
      .where('project_id', '=', scope.projectId)
      .where('status', '=', PUBLISHED)
      .orderBy('published_at', 'desc')
      .orderBy('id', 'desc')
      .execute(),
  ]);
  const saved = preferencesBody.parse(project.search_intelligence_preferences);
  return {
    ...account,
    owned_targets: ownedTargets(project, ownedDomains),
    competitors: competitors.flatMap(
      (row) => competitorTarget(row, savedDomains.parse(row.domains)) ?? [],
    ),
    preferences: { ...saved, ...searchMarket(project, saved) },
    latest_run: latest ? runView(latest) : null,
    datasets: datasets.map(datasetView),
  };
}

export async function listRuns(db: Database, scope: Scope, offset: number, limit: number) {
  const runs = await scope.workspace
    .selectFrom(db, 'search_intelligence_runs')
    .selectAll()
    .where('project_id', '=', scope.projectId)
    .where('confirmed_at', 'is not', null)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .offset(offset)
    .limit(limit)
    .execute();
  return runs.map(runView);
}

export async function getRun(db: Database, scope: Scope, runId: string) {
  const run = await scope.workspace
    .selectFrom(db, 'search_intelligence_runs')
    .selectAll()
    .where('project_id', '=', scope.projectId)
    .where('id', '=', runId)
    .executeTakeFirst();
  if (run === undefined) throw notFound('Run');
  return runView(run);
}

export type RowPageRequest = {
  cursor: string | null;
  limit: number;
  sort: string;
  direction: 'asc' | 'desc';
  search: string;
  minVolume: number | null;
  intent: string;
};

const invalidCursor = () =>
  new ApiError(422, 'Dataset cursor is invalid', { code: asApiErrorCode('invalid_cursor') });

/** The sort key: a typed column, or a numeric auxiliary metric. */
function sortKey(sort: string): RawBuilder<unknown> {
  if (AUXILIARY_SORT_FIELDS.has(sort)) return sql`(${sql.ref('auxiliary')} ->> ${sort})::numeric`;
  if (ROW_SORT_FIELDS.has(sort)) return sql.ref(sort);
  throw new ApiError(422, 'Dataset sort is unsupported', { code: asApiErrorCode('invalid_sort') });
}

function matchingRows(
  db: Database,
  scope: Scope,
  datasetId: string,
  filters: Pick<RowPageRequest, 'search' | 'minVolume' | 'intent'>,
) {
  let query = scope.workspace
    .selectFrom(db, 'search_intelligence_rows')
    .where('project_id', '=', scope.projectId)
    .where('dataset_id', '=', datasetId);
  if (filters.search) {
    const pattern = containsPattern(filters.search);
    query = query.where((eb) =>
      eb.or(SEARCHED_COLUMNS.map((column) => eb(column, 'ilike', pattern))),
    );
  }
  if (filters.minVolume !== null) query = query.where('search_volume', '>=', filters.minVolume);
  if (filters.intent) query = query.where('intent', '=', filters.intent);
  return query;
}

/** The row id a cursor resumes after; the cursor must carry this page's filters. */
function cursorRowId(cursor: string, cursorScope: string, filters: Record<string, unknown>) {
  let values: string[];
  try {
    values = decodeKeysetCursor(cursor, cursorScope, filters);
  } catch (error) {
    if (error instanceof InvalidCursorError) throw invalidCursor();
    throw error;
  }
  const only = onlyOf(values);
  const rowId = only === undefined ? null : parseUuid(only);
  if (rowId === null) throw invalidCursor();
  return rowId;
}

/**
 * One keyset page of a published dataset's rows: sorted, nulls last, ties by
 * id. The cursor names the last row returned and is bound to the dataset and
 * every filter, so it cannot resume under another ordering or filter.
 */
export async function datasetPage(
  db: Database,
  scope: Scope,
  datasetId: string,
  request: RowPageRequest,
) {
  const dataset = await publishedDataset(db, scope, datasetId);
  const key = sortKey(request.sort);
  const cursorScope = `search-intelligence:${scope.projectId}:${dataset.id}`;
  const filters = {
    sort: request.sort,
    direction: request.direction,
    limit: request.limit,
    search: request.search,
    min_volume: request.minVolume,
    intent: request.intent,
  };
  let query = matchingRows(db, scope, dataset.id, request);
  if (request.cursor !== null) {
    const after = cursorRowId(request.cursor, cursorScope, filters);
    const anchor = await matchingRows(db, scope, dataset.id, request)
      .select(key.as('value'))
      .where('id', '=', after)
      .executeTakeFirst();
    if (anchor === undefined) throw invalidCursor();
    const tie = sql<SqlBool>`${sql.ref('id')} > ${after}`;
    const beyond = request.direction === 'asc' ? sql`>` : sql`<`;
    // Nulls sort last: after a null key only later nulls remain.
    query = query.where(
      anchor.value === null
        ? sql<SqlBool>`${key} is null and ${tie}`
        : sql<SqlBool>`(${key} ${beyond} ${anchor.value} or (${key} = ${anchor.value} and ${tie}) or ${key} is null)`,
    );
  }
  const direction = request.direction === 'asc' ? sql`asc` : sql`desc`;
  const [rows, counted] = await Promise.all([
    query
      .selectAll()
      .orderBy(sql`${key} ${direction} nulls last`)
      .orderBy('id')
      .limit(request.limit + 1)
      .execute(),
    matchingRows(db, scope, dataset.id, request)
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow(),
  ]);
  const page = rows.slice(0, request.limit);
  const actions =
    dataset.dataset_kind === 'missing_keywords' ? await gapActions(db, scope) : new Map();
  return {
    dataset: { ...datasetView(dataset), filtered_saved_count: Number(counted.count) },
    rows: page.map((row) => ({ ...rowView(row), action_id: actions.get(row.id) ?? null })),
    next_cursor:
      rows.length > request.limit && isNonEmpty(page)
        ? encodeKeysetCursor(cursorScope, filters, [lastOf(page).id])
        : null,
  };
}

/** The Action each live keyword-gap finding cites a row of, by row; a read, never a refresh. */
async function gapActions(db: Database, scope: Scope) {
  const live = await scope.workspace
    .selectFrom(db, 'opportunities')
    .select(['action_id', 'source_metric_ids'])
    .where('project_id', '=', scope.projectId)
    .where('rule_id', '=', policy.opportunity.opportunities.SEARCH_GAP.RULE_ID)
    .where('superseded_at', 'is', null)
    .where('action_id', 'is not', null)
    .$narrowType<{ action_id: NotNull }>()
    .execute();
  const byRow = new Map<string, string>();
  for (const finding of live)
    for (const id of strings(finding.source_metric_ids)) byRow.set(id, finding.action_id);
  return byRow;
}

/** Selected rows of one published dataset, each with its dataset, for content work. */
export async function contentHandoff(
  db: Database,
  scope: Scope,
  datasetId: string,
  rowIds: readonly string[],
) {
  const dataset = await publishedDataset(db, scope, datasetId);
  const selected = rowIds.map((id) => id.toLowerCase());
  const requested = [...new Set(selected)];
  const rows = await scope.workspace
    .selectFrom(db, 'search_intelligence_rows')
    .selectAll()
    .where('project_id', '=', scope.projectId)
    .where('dataset_id', '=', dataset.id)
    .where('id', 'in', requested)
    .execute();
  if (rows.length !== requested.length)
    throw new ApiError(422, 'One or more evidence rows are unavailable', {
      code: asApiErrorCode('evidence_not_found'),
    });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const view = datasetView(dataset);
  return {
    project_id: scope.projectId,
    dataset_id: dataset.id,
    row_ids: selected,
    evidence: requested.map((id) => ({ ...rowView(byId.get(id)!), dataset: view })),
  };
}
