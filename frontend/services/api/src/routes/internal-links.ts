import {
  internalLinksInputSchema,
  internalLinksReadSchema,
} from '@citeladder/contracts/site-health';

import { readBody } from '../http/body.ts';
import { requireProject } from '../projects/access.ts';
import { admitLinkRun, cancelLinkRun, linkRun } from '../site-health/internal-link-runs.ts';
import { executeLinkRun } from '../site-health/internal-link-execution.ts';
import { defineGetRoute, definePostRoute } from './define.ts';

const family = 'site-health-internal-links';
const root = '/api/v1/projects/{project_id}/site-health/internal-links';
const uuid = { scalar: { kind: 'uuid' }, required: true } as const;
const projectPath = { project_id: uuid } as const;

export const internalLinkRoutes = [
  definePostRoute({
    family,
    path: `${root}/analyses/{analysis_id}/run`,
    capability: 'run',
    params: { path: { ...projectPath, analysis_id: uuid }, query: {} },
    response: internalLinksReadSchema,
    async handle({ c, db, config }, { path }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      const scope = { workspaceId: workspace.workspaceId, projectId: path.project_id };
      await linkRun(db, scope, path.analysis_id);
      await executeLinkRun(db, config, scope, path.analysis_id);
      return linkRun(db, scope, path.analysis_id);
    },
  }),
  defineGetRoute({
    family,
    path: root,
    params: { path: projectPath, query: { analysis_id: { scalar: { kind: 'uuid' } } } },
    response: internalLinksReadSchema,
    async handle({ c, db }, { path, query }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return linkRun(
        db,
        { workspaceId: workspace.workspaceId, projectId: path.project_id },
        query.analysis_id ?? undefined,
      );
    },
  }),
  definePostRoute({
    family,
    path: `${root}/analyses`,
    capability: 'run',
    status: 202,
    params: { path: projectPath, query: {} },
    body: internalLinksInputSchema,
    response: internalLinksReadSchema,
    async handle({ c, db }, { path }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return admitLinkRun(
        db,
        { workspaceId: workspace.workspaceId, projectId: path.project_id },
        c.get('user').id,
        await readBody(c, internalLinksInputSchema),
      );
    },
  }),
  definePostRoute({
    family,
    path: `${root}/analyses/{analysis_id}/cancel`,
    capability: 'run',
    params: { path: { ...projectPath, analysis_id: uuid }, query: {} },
    response: internalLinksReadSchema,
    async handle({ c, db }, { path }) {
      const workspace = c.get('workspace');
      await requireProject(db, workspace, path.project_id);
      return cancelLinkRun(
        db,
        { workspaceId: workspace.workspaceId, projectId: path.project_id },
        path.analysis_id,
      );
    },
  }),
];
