/** The project Overview's shared layout and its PDF export. */
import { overviewLayoutSchema, overviewLayoutUpdateSchema } from '@citeladder/contracts/overview';
import { z } from 'zod';

import { readBody } from '../http/body.ts';
import { readOverviewLayout, updateOverviewLayout } from '../projects/overview-layout.ts';
import { overviewReport } from '../projects/overview-report.ts';
import { defineGetRoute, definePutRoute } from './define.ts';

const family = 'overview';
const root = '/api/v1/projects/{project_id}/overview';
const projectPath = { project_id: { scalar: { kind: 'uuid' }, required: true } } as const;

export const overviewRoutes = [
  defineGetRoute({
    family,
    path: `${root}/layout`,
    params: { path: projectPath, query: {} },
    response: overviewLayoutSchema,
    handle: ({ c, db }, { path }) =>
      readOverviewLayout(db, {
        workspaceId: c.get('workspace').workspaceId,
        projectId: path.project_id,
      }),
  }),
  definePutRoute({
    family,
    path: `${root}/layout`,
    capability: 'write',
    params: { path: projectPath, query: {} },
    body: overviewLayoutUpdateSchema,
    response: overviewLayoutSchema,
    async handle({ c, db }, { path }) {
      const body = await readBody(c, overviewLayoutUpdateSchema);
      return updateOverviewLayout(
        db,
        { workspaceId: c.get('workspace').workspaceId, projectId: path.project_id },
        { widgets: body.widgets, expectedVersion: body.expected_version, userId: c.get('user').id },
      );
    },
  }),
  defineGetRoute({
    family,
    path: `${root}/report.pdf`,
    params: { path: projectPath, query: {} },
    response: z.string().meta({ format: 'binary' }),
    raw: true,
    async handle({ c, db }, { path }) {
      const result = await overviewReport(db, {
        workspaceId: c.get('workspace').workspaceId,
        projectId: path.project_id,
      });
      return c.body(new Uint8Array(result.bytes).buffer, 200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'X-Content-Type-Options': 'nosniff',
      });
    },
  }),
];
