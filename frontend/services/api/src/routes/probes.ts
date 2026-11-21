import { auditSchema } from '@citeladder/contracts/audits';
import {
  objectionGroupMergeRequestSchema,
  objectionGroupSchema as groupSchema,
  probeMarketSchema,
  probeObjectionsSchema,
  probeRunRequestSchema,
  probeScheduleRequestSchema,
  probeStatusSchema,
} from '@citeladder/contracts/probes';
import { z } from 'zod';

import { auditRuntime } from '../audits/config.ts';
import { readAudits } from '../audits/reads.ts';
import { readBody } from '../http/body.ts';
import { probeMarket } from '../probes/market.ts';
import { deleteGroup, groupRequest, mergeGroups, renameGroup } from '../probes/objection-groups.ts';
import { probeObjections } from '../probes/objections.ts';
import { setProbeSchedule } from '../probes/schedule.ts';
import { runProbe } from '../probes/plan.ts';
import { probeStatus } from '../probes/status.ts';
import {
  defineDeleteRoute,
  defineGetRoute,
  definePatchRoute,
  definePostRoute,
  definePutRoute,
  projectScopeOf,
} from './define.ts';

const activeProject = { family: 'probes', authorize: 'active-project' } as const;
const root = '/api/v1/projects/{project_id}/probes';
const uuid = { scalar: { kind: 'uuid' }, required: true } as const;
const projectPath = { project_id: uuid } as const;
const groupPath = { ...projectPath, group_id: uuid } as const;

export const probeRoutes = [
  defineGetRoute({
    ...activeProject,
    path: root,
    params: { path: projectPath, query: {} },
    response: probeStatusSchema,
    handle: ({ c, db, config }, { path }) =>
      probeStatus(db, projectScopeOf(c, path.project_id), auditRuntime(config.settings)),
  }),
  definePostRoute({
    ...activeProject,
    path: root,
    capability: 'run',
    status: 201,
    params: { path: projectPath, query: {} },
    body: probeRunRequestSchema,
    response: z.array(auditSchema),
    async handle({ c, db, config }, { path }) {
      const scope = projectScopeOf(c, path.project_id);
      const input = await readBody(c, probeRunRequestSchema);
      const ids = await runProbe(db, scope, input, auditRuntime(config.settings));
      return readAudits(db, scope.workspaceId, ids);
    },
  }),
  definePutRoute({
    ...activeProject,
    path: `${root}/schedule`,
    capability: 'write',
    params: { path: projectPath, query: {} },
    body: probeScheduleRequestSchema,
    response: probeStatusSchema,
    async handle({ c, db, config }, { path }) {
      const scope = projectScopeOf(c, path.project_id);
      const input = await readBody(c, probeScheduleRequestSchema);
      const runtime = auditRuntime(config.settings);
      await setProbeSchedule(db, scope, input, runtime);
      return probeStatus(db, scope, runtime);
    },
  }),
  defineGetRoute({
    ...activeProject,
    path: `${root}/market`,
    params: { path: projectPath, query: {} },
    response: probeMarketSchema,
    handle: ({ c, db }, { path }) => probeMarket(db, projectScopeOf(c, path.project_id)),
  }),
  defineGetRoute({
    ...activeProject,
    path: `${root}/objections`,
    params: { path: projectPath, query: {} },
    response: probeObjectionsSchema,
    handle: ({ c, db }, { path }) => probeObjections(db, projectScopeOf(c, path.project_id)),
  }),
  definePatchRoute({
    ...activeProject,
    path: `${root}/objection-groups/{group_id}`,
    capability: 'write',
    params: { path: groupPath, query: {} },
    body: groupRequest,
    response: groupSchema,
    async handle({ c, db }, { path }) {
      const input = await readBody(c, groupRequest);
      return renameGroup(
        db,
        { ...projectScopeOf(c, path.project_id), groupId: path.group_id },
        input,
      );
    },
  }),
  definePostRoute({
    ...activeProject,
    path: `${root}/objection-groups/{group_id}/merge`,
    capability: 'write',
    params: { path: groupPath, query: {} },
    body: objectionGroupMergeRequestSchema,
    response: groupSchema,
    async handle({ c, db }, { path }) {
      const { into_id: intoId } = await readBody(c, objectionGroupMergeRequestSchema);
      return mergeGroups(db, {
        ...projectScopeOf(c, path.project_id),
        groupId: path.group_id,
        intoId,
      });
    },
  }),
  defineDeleteRoute({
    ...activeProject,
    path: `${root}/objection-groups/{group_id}`,
    capability: 'write',
    params: { path: groupPath, query: {} },
    handle: ({ c, db }, { path }) =>
      deleteGroup(db, { ...projectScopeOf(c, path.project_id), groupId: path.group_id }),
  }),
];
