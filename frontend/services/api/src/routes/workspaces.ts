import { workspaceSchema } from '@citeladder/contracts/auth';
import { z } from 'zod';
import { defineGetRoute } from './define.ts';
import { workspaceView } from '../workspaces/service.ts';

export const workspaceRoutes = [
  defineGetRoute({
    family: 'workspaces',
    authorize: 'session',
    path: '/api/v1/workspaces',
    params: { path: {}, query: {} },
    response: z.array(workspaceSchema),
    async handle({ c, db }) {
      const rows = await db
        .selectFrom('workspaces')
        .innerJoin('workspace_members', 'workspace_members.workspace_id', 'workspaces.id')
        .selectAll('workspaces')
        .select('workspace_members.role')
        .where('workspace_members.user_id', '=', c.get('user').id)
        .where('workspaces.is_system', '=', false)
        .orderBy('workspaces.created_at')
        .orderBy('workspaces.id')
        .execute();
      return rows.map((row) => workspaceView(row, row.role));
    },
  }),
];
