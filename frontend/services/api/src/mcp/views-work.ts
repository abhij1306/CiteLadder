import { ACTION_STATUS_ANY } from '@citeladder/contracts/action-status';
import type { ActionTreeGroupBy } from '@citeladder/contracts/actions';
import { policy } from '../config.ts';
import { shoppingOverview } from '../commerce/overview.ts';
import { catalog } from '../commerce/reads.ts';
import { actionTree, urlActions } from '../opportunities/action-tree.ts';
import { cursorOffset, offsetPage, reference, unavailable } from './data.ts';
import { withoutQuery } from './evidence-site.ts';
import { appLink } from './links.ts';
import { McpInputError, type Evidence, type ProjectRead } from './types.ts';

type Page = { cursor?: string | null; limit?: number | null };
type ActionFilters = { status?: string | null; query?: string | null };
const ACTIVE = new Set(['open', 'in_progress']);

const linked = (read: ProjectRead) => (item: { id: string }) => ({
  ...item,
  link: appLink(read.origin, `/actions/${item.id}`, read.scope.projectId),
});

export async function pageActions(
  read: ProjectRead,
  args: Page & ActionFilters & { site_url_id: string },
): Promise<Evidence> {
  if (args.query) throw new McpInputError('query does not combine with site_url_id');
  const page = await urlActions(read.db, read.scope, args.site_url_id);
  const status = args.status ?? null;
  const kept = page.items.filter(
    (item) =>
      status === ACTION_STATUS_ANY ||
      (status === null ? ACTIVE.has(item.status) : item.status === status),
  );
  const key = ['page_actions', args.site_url_id, status ?? ''];
  const { items, pagination } = offsetPage(kept.map(linked(read)), {
    offset: cursorOffset(args.cursor, key),
    limit: args.limit ?? policy.opportunity.actions.ACTION_LIST_DEFAULT_LIMIT,
    selection: key,
  });
  return {
    state: 'available',
    page: {
      site_url_id: page.site_url_id,
      url: withoutQuery(page.url),
      page_kind: page.page_kind,
      last_crawled_at: page.last_crawled_at,
    },
    items,
    pagination,
    artifact_refs: items.map((item) => reference('action', item.id)),
  };
}

export async function actionGroups(
  read: ProjectRead,
  args: ActionFilters & { group_by: ActionTreeGroupBy },
): Promise<Evidence> {
  const tree = await actionTree(read.db, read.scope, {
    group_by: args.group_by,
    status: args.status ?? null,
    q: args.query ?? null,
  });
  const link = linked(read);
  return {
    state: 'available',
    group_by: tree.group_by,
    status_counts: tree.status_counts,
    goals: tree.goals,
    groups: tree.groups.map((group) => ({
      ...group,
      groupings: group.groupings.map(({ next_cursor: _next, ...grouping }) => ({
        ...grouping,
        items: grouping.items.map(link),
        has_more: grouping.count > grouping.items.length,
      })),
    })),
    artifact_refs: [],
  };
}

export const noCatalog = (applicability: string): Evidence => ({
  ...unavailable('no_product_catalog'),
  business_applicability: applicability,
});

export async function shoppingTotals(
  read: ProjectRead,
  args: { category_id?: string | null; window_days: number },
): Promise<Evidence> {
  const { product_total, categories, projection } = await catalog(read.db, read.scope);
  if (projection.applicability !== 'applicable' && !product_total)
    return noCatalog(projection.applicability);
  if (args.category_id && !categories.some((category) => category.id === args.category_id))
    throw new McpInputError('category_id is not a category of this project');
  const overview = await shoppingOverview(read.db, read.scope, {
    windowDays: args.window_days,
    category: args.category_id ?? null,
  });
  return { state: 'available', view: 'overview', ...overview, artifact_refs: [] };
}
