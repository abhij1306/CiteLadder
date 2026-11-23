import {
  brandProfileSchema,
  businessMapSchema,
  competitorSchema,
  projectThemeSchema,
} from '@citeladder/contracts/project';
import {
  brandFactImportResultSchema,
  brandFactListSchema,
  brandFactSchema,
  verdictOverrideSchema,
} from '@citeladder/contracts/fact-checking';
import { observedCompetitorSchema } from '@citeladder/contracts/visibility';
import type { Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context.ts';
import type { Database } from '../db/database.ts';
import { readBody } from '../http/body.ts';
import {
  brandProfileUpdate,
  readBrandProfile,
  updateBrandProfile,
} from '../projects/brand-profile.ts';
import { overrideVerdict, verdictOverrideRequest } from '../perception/verdict-overrides.ts';
import {
  brandFactCreate,
  brandFactImport,
  brandFactUpdate,
  createBrandFact,
  importBrandFacts,
  listBrandFacts,
  updateBrandFact,
} from '../projects/brand-facts.ts';
import { businessMapUpdate, readBusinessMap, updateBusinessMap } from '../projects/business-map.ts';
import { projectThemeMergeRequestSchema } from '@citeladder/contracts/project-requests';
import {
  createTheme,
  deleteTheme,
  listThemes,
  renameTheme,
  themeRequest,
} from '../projects/themes.ts';
import { mergeCategories } from '../perception/category-merge.ts';
import { acceptSuggestion, COMPETITORS_WRITE, rejectSuggestion } from '../commands/competitors.ts';
import { routeActor } from '../commands/permission.ts';
import { listSuggestions } from '../projects/competitor-suggestions.ts';
import { logoResponse } from '../projects/logos.ts';
import {
  defineDeleteRoute,
  defineGetRoute,
  definePatchRoute,
  definePostRoute,
  definePutRoute,
  projectScopeOf,
} from './define.ts';
import { fileResponse } from './opportunity-contracts.ts';

const family = 'brand-identity';
const activeProject = { family, authorize: 'active-project' } as const;
const root = '/api/v1/projects/{project_id}';
const uuid = { scalar: { kind: 'uuid' }, required: true } as const;
const projectPath = { project_id: uuid } as const;

function serveLogo(
  c: Context<AppEnv>,
  db: Database,
  projectId: string,
  competitorId: string | null,
) {
  const scope = { workspaceId: c.get('workspace').workspaceId, projectId };
  return logoResponse(db, scope, competitorId, c.req.header('if-none-match'));
}

export const brandIdentityRoutes = [
  defineGetRoute({
    ...activeProject,
    path: `${root}/brand-profile`,
    params: { path: projectPath, query: {} },
    response: brandProfileSchema,
    async handle({ c, db }, { path }) {
      return readBrandProfile(db, projectScopeOf(c, path.project_id));
    },
  }),
  definePutRoute({
    ...activeProject,
    path: `${root}/brand-profile`,
    capability: 'write',
    params: { path: projectPath, query: {} },
    body: brandProfileUpdate,
    response: brandProfileSchema,
    async handle({ c, db }, { path }) {
      const scope = projectScopeOf(c, path.project_id);
      const update = await readBody(c, brandProfileUpdate);
      return updateBrandProfile(db, scope, c.get('user').id, update);
    },
  }),
  defineGetRoute({
    ...activeProject,
    path: `${root}/brand-facts`,
    params: { path: projectPath, query: {} },
    response: brandFactListSchema,
    async handle({ c, db }, { path }) {
      return listBrandFacts(db, projectScopeOf(c, path.project_id));
    },
  }),
  definePostRoute({
    ...activeProject,
    path: `${root}/brand-facts`,
    capability: 'write',
    params: { path: projectPath, query: {} },
    body: brandFactCreate,
    response: brandFactSchema,
    async handle({ c, db }, { path }) {
      const scope = projectScopeOf(c, path.project_id);
      return createBrandFact(db, scope, c.get('user').id, await readBody(c, brandFactCreate));
    },
  }),
  definePostRoute({
    ...activeProject,
    path: `${root}/brand-facts/import`,
    capability: 'write',
    params: { path: projectPath, query: {} },
    body: brandFactImport,
    response: brandFactImportResultSchema,
    async handle({ c, db }, { path }) {
      const scope = projectScopeOf(c, path.project_id);
      const input = await readBody(c, brandFactImport);
      return importBrandFacts(db, scope, c.get('user').id, input);
    },
  }),
  definePostRoute({
    ...activeProject,
    path: `${root}/claim-verdicts/{verdict_id}/overrides`,
    capability: 'write',
    params: { path: { ...projectPath, verdict_id: uuid }, query: {} },
    body: verdictOverrideRequest,
    response: verdictOverrideSchema,
    async handle({ c, db }, { path }) {
      const change = await readBody(c, verdictOverrideRequest);
      return overrideVerdict(db, {
        scope: projectScopeOf(c, path.project_id),
        userId: c.get('user').id,
        verdictId: path.verdict_id,
        change,
      });
    },
  }),
  definePatchRoute({
    ...activeProject,
    path: `${root}/brand-facts/{fact_id}`,
    capability: 'write',
    params: { path: { ...projectPath, fact_id: uuid }, query: {} },
    body: brandFactUpdate,
    response: brandFactSchema,
    async handle({ c, db }, { path }) {
      const scope = projectScopeOf(c, path.project_id);
      const update = await readBody(c, brandFactUpdate);
      return updateBrandFact(db, scope, c.get('user').id, path.fact_id, update);
    },
  }),
  defineGetRoute({
    ...activeProject,
    path: `${root}/themes`,
    params: { path: projectPath, query: {} },
    response: z.array(projectThemeSchema),
    handle: ({ c, db }, { path }) => listThemes(db, projectScopeOf(c, path.project_id)),
  }),
  definePostRoute({
    ...activeProject,
    path: `${root}/themes`,
    capability: 'write',
    status: 201,
    params: { path: projectPath, query: {} },
    body: themeRequest,
    response: projectThemeSchema,
    async handle({ c, db }, { path }) {
      return createTheme(db, projectScopeOf(c, path.project_id), await readBody(c, themeRequest));
    },
  }),
  definePatchRoute({
    ...activeProject,
    path: `${root}/themes/{theme_id}`,
    capability: 'write',
    params: { path: { ...projectPath, theme_id: uuid }, query: {} },
    body: themeRequest,
    response: projectThemeSchema,
    async handle({ c, db }, { path }) {
      const input = await readBody(c, themeRequest);
      return renameTheme(
        db,
        { ...projectScopeOf(c, path.project_id), themeId: path.theme_id },
        input,
      );
    },
  }),
  definePostRoute({
    ...activeProject,
    path: `${root}/themes/{theme_id}/merge`,
    capability: 'write',
    params: { path: { ...projectPath, theme_id: uuid }, query: {} },
    body: projectThemeMergeRequestSchema,
    response: projectThemeSchema,
    async handle({ c, db }, { path }) {
      const { into_id: intoId } = await readBody(c, projectThemeMergeRequestSchema);
      return mergeCategories(db, {
        ...projectScopeOf(c, path.project_id),
        themeId: path.theme_id,
        intoId,
      });
    },
  }),
  defineDeleteRoute({
    ...activeProject,
    path: `${root}/themes/{theme_id}`,
    capability: 'write',
    params: { path: { ...projectPath, theme_id: uuid }, query: {} },
    handle: ({ c, db }, { path }) =>
      deleteTheme(db, { ...projectScopeOf(c, path.project_id), themeId: path.theme_id }),
  }),
  defineGetRoute({
    ...activeProject,
    exposure: 'both',
    path: `${root}/business-map`,
    params: { path: projectPath, query: {} },
    response: businessMapSchema,
    async handle({ c, db }, { path }) {
      return readBusinessMap(db, projectScopeOf(c, path.project_id));
    },
  }),
  definePutRoute({
    ...activeProject,
    path: `${root}/business-map`,
    capability: 'write',
    params: { path: projectPath, query: {} },
    body: businessMapUpdate,
    response: businessMapSchema,
    async handle({ c, db }, { path }) {
      const scope = projectScopeOf(c, path.project_id);
      const update = await readBody(c, businessMapUpdate);
      return updateBusinessMap(db, scope, c.get('user').id, update);
    },
  }),
  defineGetRoute({
    ...activeProject,
    exposure: 'both',
    path: `${root}/competitor-suggestions`,
    params: { path: projectPath, query: {} },
    response: z.array(observedCompetitorSchema),
    async handle({ c, db }, { path }) {
      return listSuggestions(db, projectScopeOf(c, path.project_id));
    },
  }),
  definePostRoute({
    ...activeProject,
    exposure: 'both',
    permission: COMPETITORS_WRITE,
    path: `${root}/competitor-suggestions/{candidate_id}/accept`,
    params: { path: { ...projectPath, candidate_id: uuid }, query: {} },
    response: competitorSchema,
    handle: ({ c, db }, { path }) =>
      acceptSuggestion(db, routeActor(c, COMPETITORS_WRITE), path.project_id, path.candidate_id),
  }),
  definePostRoute({
    ...activeProject,
    exposure: 'both',
    permission: COMPETITORS_WRITE,
    path: `${root}/competitor-suggestions/{candidate_id}/reject`,
    params: { path: { ...projectPath, candidate_id: uuid }, query: {} },
    response: observedCompetitorSchema,
    handle: ({ c, db }, { path }) =>
      rejectSuggestion(db, routeActor(c, COMPETITORS_WRITE), path.project_id, path.candidate_id),
  }),
  defineGetRoute({
    family,
    path: `${root}/logo`,
    authorize: 'project',
    params: { path: projectPath, query: {} },
    response: fileResponse,
    raw: true,
    handle: ({ c, db }, { path }) => serveLogo(c, db, path.project_id, null),
  }),
  defineGetRoute({
    family,
    path: `${root}/competitors/{competitor_id}/logo`,
    authorize: 'project',
    params: { path: { ...projectPath, competitor_id: uuid }, query: {} },
    response: fileResponse,
    raw: true,
    handle: ({ c, db }, { path }) => serveLogo(c, db, path.project_id, path.competitor_id),
  }),
];
