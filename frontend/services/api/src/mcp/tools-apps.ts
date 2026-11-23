import { z } from 'zod';
import { analyticsSelectionSchema } from '@citeladder/contracts/mcp-app';
import { renderAnalytics } from './evidence-analytics.ts';
import { snapshot_id, project, tool, projectScoped } from './tool-definitions.ts';

export const appTools = {
  render_visibility: projectScoped({
    title: 'Show AI visibility',
    description:
      'Show the user an interactive visibility view, in clients that display apps: overview, trends over a window, or cited sources for one run. To reason over the numbers yourself, use read_visibility_overview, read_visibility_trends or read_visibility_sources.',
    schema: analyticsSelectionSchema.extend({
      view: z
        .enum(['overview', 'trends', 'sources'])
        .default('overview')
        .describe('Which view to show; each other field says the views it applies to.'),
    }),
    read: ({ db, scope, origin }, args) => renderAnalytics(db, scope, args, origin),
  }),
  render_site_health: projectScoped({
    title: 'Show Site Health',
    description:
      'Show the user an interactive Site Health view (scores, coverage and top issues) for the latest or a chosen snapshot, in clients that display apps. To reason over the data yourself, use read_site_health.',
    schema: z.strictObject({ ...project, snapshot_id }),
    read: ({ db, scope, origin }, args) =>
      renderAnalytics(
        db,
        scope,
        analyticsSelectionSchema.parse({ ...args, view: 'site_health' }),
        origin,
      ),
  }),
  open_analytics: tool({
    title: 'Open CiteLadder',
    description:
      'Show the user the CiteLadder project picker, in clients that display apps, so they can choose a project to view. Use list_projects to find projects yourself.',
    schema: z.strictObject({}),
    read: ({ origin }) =>
      Promise.resolve({
        surface: 'citeladder_analytics',
        selection: null,
        evidence: {},
        links: { application: origin, onboarding: `${origin}/onboarding` },
      }),
  }),
};
