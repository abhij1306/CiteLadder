import {
  actionGoalSchema,
  actionGroupingSchema,
  actionStatusSchema,
  type ActionGrouping,
  type ActionTreeGroupBy,
} from '@citeladder/contracts/actions';
import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { utcTextOf, wireUtc } from '../db/timestamps.ts';
import { notFound } from '../errors.ts';
import { compareText } from '../text-order.ts';
import { goalSql, groupingSql, groupKeySql, GROUPING_ORDER } from './action-groupings.ts';
import { statusView } from './action-status.ts';
import { pageKindOf } from './action-urls.ts';
import {
  actionItem,
  LISTED_ACTION,
  listCursor,
  matchingActions,
  parseFilters,
  type ActionRow,
} from './actions.ts';
import type { Scope } from './sources.ts';

const a = policy.opportunity.actions;
const PAGE = a.ACTION_TREE_PAGE_SIZE;

type TreeFilters = Omit<Parameters<typeof parseFilters>[0], 'grouping'> & {
  group_by: ActionTreeGroupBy;
};

function groupFilter(groupBy: ActionTreeGroupBy, key: string) {
  switch (groupBy) {
    case 'goal':
      return {};
    case 'what_to_do':
      return { approach: key };
    case 'impact':
      return { priority: key };
    case 'ownership':
      return { ownership: key };
    case 'topic':
      return { topic: key };
    default: {
      const unknown: never = groupBy;
      return unknown;
    }
  }
}

function groupRank(groupBy: ActionTreeGroupBy): (key: string) => number {
  const fixed: Partial<Record<ActionTreeGroupBy, readonly string[]>> = {
    goal: actionGoalSchema.options,
    impact: ['high', 'medium', 'low'],
    ownership: ['owned', 'earned'],
  };
  const order = fixed[groupBy];
  return (key) => (order ? order.indexOf(key) : 0);
}

export async function actionTree(db: Database, scope: Scope, raw: TreeFilters) {
  const { group_by: groupBy, ...rest } = raw;
  const filtered = matchingActions(db, scope, { ...rest, grouping: null });
  const key = groupKeySql(groupBy);
  const priority = sql<number>`coalesce(actions.priority_score, -1)`;
  const [statuses, counts, open, blocking, rows] = await Promise.all([
    db
      .selectFrom('actions')
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where(LISTED_ACTION)
      .select(['effective_status as status', sql<number>`count(*)::int`.as('count')])
      .groupBy('effective_status')
      .execute(),
    filtered
      .select([key.as('key'), groupingSql.as('grouping'), sql<number>`count(*)::int`.as('count')])
      .groupBy([sql`1`, sql`2`])
      .execute(),
    matchingActions(db, scope, { ...rest, grouping: null, status: null })
      .select([goalSql.as('goal'), sql<number>`count(*)::int`.as('count')])
      .groupBy(sql`1`)
      .execute(),
    db
      .selectFrom('actions')
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where(LISTED_ACTION)
      .where('effective_status', '=', a.ACTION_STATUS_OPEN)
      .where(groupingSql, 'in', [...a.ACTION_BLOCKING_GROUPINGS])
      .where('priority_score', '>=', a.ACTION_BLOCKING_MIN_PRIORITY)
      .select('id')
      .limit(1)
      .executeTakeFirst(),
    db
      .selectFrom(
        filtered
          .selectAll()
          .select([
            key.as('tree_key'),
            groupingSql.as('tree_grouping'),
            sql<number>`row_number() over (partition by ${key}, ${groupingSql}
              order by ${priority} desc, actions.id)`.as('tree_rank'),
          ])
          .as('ranked'),
      )
      .selectAll()
      .where('tree_rank', '<=', PAGE)
      .orderBy('tree_rank')
      .execute(),
  ]);
  const byGrouping = new Map<string, (ActionRow & { tree_rank: number })[]>();
  for (const row of rows) {
    const id = JSON.stringify([row.tree_key, row.tree_grouping]);
    byGrouping.set(id, [...(byGrouping.get(id) ?? []), row]);
  }
  const groups = new Map<string, { key: string; count: number; groupings: typeof counts }>();
  for (const row of counts) {
    const group = groups.get(row.key) ?? { key: row.key, count: 0, groupings: [] };
    group.count += row.count;
    group.groupings.push(row);
    groups.set(row.key, group);
  }
  const rank = groupRank(groupBy);
  const position = (grouping: string) => GROUPING_ORDER.indexOf(grouping as ActionGrouping);
  return {
    group_by: groupBy,
    status_counts: Object.fromEntries(
      actionStatusSchema.options.map((status) => [
        status,
        statuses
          .filter((row) => statusView(row.status).status === status)
          .reduce((sum, row) => sum + row.count, 0),
      ]),
    ),
    goals: actionGoalSchema.options.map((goal) => ({
      goal,
      count: open.find((row) => row.goal === goal)?.count ?? 0,
      blocking: goal === 'read_site' && blocking !== undefined,
    })),
    groups: [...groups.values()]
      .sort(
        (left, right) =>
          rank(left.key) - rank(right.key) ||
          right.count - left.count ||
          compareText(left.key, right.key),
      )
      .map((group) => ({
        key: group.key,
        count: group.count,
        groupings: group.groupings
          .sort((left, right) => position(left.grouping) - position(right.grouping))
          .map((row) => {
            const items = byGrouping.get(JSON.stringify([group.key, row.grouping])) ?? [];
            const last = items.at(-1);
            const next = parseFilters({
              ...rest,
              ...groupFilter(groupBy, group.key),
              grouping: row.grouping,
            });
            return {
              grouping: actionGroupingSchema.parse(row.grouping),
              count: row.count,
              items: items.map(actionItem),
              next_cursor: row.count > PAGE && last ? listCursor(scope, next, last) : null,
            };
          }),
      })),
  };
}

export async function urlActions(db: Database, scope: Scope, siteUrlId: string) {
  const url = await db
    .selectFrom('site_urls')
    .select([
      'id',
      'normalized_url',
      pageKindOf.as('page_kind'),
      utcTextOf(sql.ref('last_seen_at')).as('last_seen_text'),
    ])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('id', '=', siteUrlId)
    .executeTakeFirst();
  if (!url) throw notFound('URL');
  const rows = await db
    .selectFrom('actions')
    .selectAll('actions')
    .innerJoin('action_urls', (join) =>
      join
        .onRef('action_urls.workspace_id', '=', 'actions.workspace_id')
        .onRef('action_urls.action_id', '=', 'actions.id'),
    )
    .where('action_urls.workspace_id', '=', scope.workspaceId)
    .where('action_urls.project_id', '=', scope.projectId)
    .where('action_urls.site_url_id', '=', siteUrlId)
    .where('actions.project_id', '=', scope.projectId)
    .where(LISTED_ACTION)
    .orderBy(sql`coalesce(actions.priority_score, -1)`, 'desc')
    .orderBy('actions.id')
    .execute();
  return {
    site_url_id: url.id,
    url: url.normalized_url,
    page_kind: url.page_kind,
    last_crawled_at: wireUtc(url.last_seen_text),
    items: rows.map(actionItem),
  };
}
