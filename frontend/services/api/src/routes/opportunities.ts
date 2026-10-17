/**
 * The `opportunities` family: the persisted catalog, the row detail and the
 * shared order. Every lookup is filtered by the active workspace, so a foreign
 * id is a 404. Refreshes run only from evidence triggers.
 */
import { policy } from '../config.ts';
import { readBody } from '../http/body.ts';
import { parseUuid } from '../http/uuid.ts';
import { getOpportunity, listOpportunities } from '../opportunities/reads.ts';
import { updateOrder } from '../opportunities/order.ts';
import { defineGetRoute, definePutRoute } from './define.ts';
import {
  opportunitiesPageSchema,
  opportunityDetailSchema,
  opportunityOrderResponseSchema,
} from '@citeladder/contracts/opportunities';
import { orderUpdate } from './opportunity-contracts.ts';

const family = 'opportunities';
const root = '/api/v1/projects/{project_id}/opportunities';
const o = policy.opportunity.opportunities;
const projectPath = { project_id: { scalar: { kind: 'uuid' }, required: true } } as const;
const filterQuery = {
  type_filter: { scalar: { kind: 'str' }, alias: 'type' },
  severity: { scalar: { kind: 'str' } },
  status_filter: { scalar: { kind: 'str' }, alias: 'status' },
  rule_id: { scalar: { kind: 'str' } },
  min_priority: { scalar: { kind: 'float' } },
} as const;

type FilterValues = {
  type_filter: string | null;
  severity: string | null;
  status_filter: string | null;
  rule_id: string | null;
  min_priority: number | null;
};

const filters = (query: FilterValues) => ({
  type: query.type_filter,
  severity: query.severity,
  status: query.status_filter,
  rule_id: query.rule_id,
  min_priority: query.min_priority,
});

export const opportunityRoutes = [
  defineGetRoute({
    family,
    path: root,
    params: {
      path: projectPath,
      query: {
        ...filterQuery,
        limit: {
          scalar: { kind: 'int', ge: 1, le: o.LIST_MAX_LIMIT },
          default: o.LIST_DEFAULT_LIMIT,
        },
        cursor: { scalar: { kind: 'str' } },
      },
    },
    response: opportunitiesPageSchema,
    async handle({ c, db }, { path, query }) {
      const scope = { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id };
      return listOpportunities(db, scope, filters(query), {
        limit: query.limit,
        cursor: query.cursor,
      });
    },
  }),
  defineGetRoute({
    family,
    path: '/api/v1/opportunities/{opportunity_id}',
    params: {
      path: { opportunity_id: { scalar: { kind: 'uuid' }, required: true } },
      query: {},
    },
    response: opportunityDetailSchema,
    async handle({ c, db }, { path }) {
      return getOpportunity(db, c.get('workspace').workspaceId, path.opportunity_id);
    },
  }),
  definePutRoute({
    family,
    path: `${root}/order`,
    capability: 'write',
    params: { path: projectPath, query: {} },
    body: orderUpdate,
    response: opportunityOrderResponseSchema,
    async handle({ c, db }, { path }) {
      const body = await readBody(c, orderUpdate);
      return updateOrder(
        db,
        { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id },
        {
          orderedIds: body.ordered_opportunity_ids.map((id) => parseUuid(id)!),
          expectedVersion: body.expected_version,
          userId: c.get('user').id,
        },
      );
    },
  }),
];
