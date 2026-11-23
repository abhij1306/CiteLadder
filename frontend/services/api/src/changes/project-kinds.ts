import { sql } from 'kysely';
import { z } from 'zod';
import { projectMarketCreateSchema } from '@citeladder/contracts/markets';
import { suggestionRows } from '../analysis/observed-competitors.ts';
import {
  acceptSuggestion,
  addCompetitor,
  COMPETITORS_WRITE,
  rejectSuggestion,
  removeCompetitor,
  updateCompetitor,
} from '../commands/competitors.ts';
import { competitorCreate, competitorUpdate, listCompetitors } from '../projects/competitors.ts';
import { refreshProjectLogos } from '../projects/logo-refresh.ts';
import { addMarket, deleteMarket, listMarkets } from '../projects/markets.ts';
import { projectUpdate } from '../projects/inputs.ts';
import { readProject, updateProject } from '../projects/service.ts';
import {
  changeKind,
  countOf,
  MEMBER_WRITE,
  PERMANENT,
  ROW_COUNT,
  rowsOf,
  type PreviewContext,
} from './kind.ts';

const scopeOf = ({ workspaceId, projectId }: PreviewContext) => ({ workspaceId, projectId });

async function competitorName(context: PreviewContext, competitorId: string) {
  const competitors = await listCompetitors(context.db, scopeOf(context));
  return competitors.find((row) => row.id === competitorId)?.name ?? '';
}

const replaced = (label: string, values: readonly string[] | undefined) => {
  if (values === undefined) return [];
  return values.length ? rowsOf(label, values) : [{ label, value: 'None: all are removed' }];
};

const projectEdit = projectUpdate
  .omit({ competitors: true })
  .refine((edit) => Object.values(edit).some((value) => value !== undefined), {
    message: 'An edit changes at least one field',
  });

const shown = (value: unknown) =>
  value === null || value === undefined || value === '' ? 'empty' : String(value);

export const projectKinds = {
  update_project: changeKind({
    permission: COMPETITORS_WRITE,
    purpose:
      'edit the project details of its edit panel; lists are replaced whole, competitors use the competitor kinds',
    payload: projectEdit,
    async execute(trx, _config, actor, change, payload) {
      const project = await updateProject(trx, actor, change.projectId, payload);
      return { summary: `Updated the project ${project.name}.` };
    },
    async preview(context, payload) {
      const row = await context.db
        .selectFrom('projects')
        .selectAll()
        .where('workspace_id', '=', context.workspaceId)
        .where('id', '=', context.projectId)
        .executeTakeFirstOrThrow();
      const current: Record<string, unknown> = row;
      const { brand, owned_domains: owned, unintended_domains: unintended, ...details } = payload;
      const { entity_matching: entities, ...scalars } = details;
      return {
        title: 'Change the project details',
        rows: [
          ...Object.entries(scalars)
            .filter(([, value]) => value !== undefined)
            .map(([field, value]) => ({
              label: field.replaceAll('_', ' '),
              value: `${shown(current[field])} → ${shown(value)}`,
            })),
          ...replaced('Also called', brand?.aliases),
          ...replaced('Owned domain', owned),
          ...replaced('Unintended domain', unintended),
          ...replaced(
            'Entity matching',
            entities?.map(
              (entity) =>
                `${entity.name} (${entity.mode}; context ${entity.context_terms.join(', ') || 'none'}; excluding ${entity.exclusion_phrases.join(', ') || 'none'})`,
            ),
          ),
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  add_competitor: changeKind({
    permission: COMPETITORS_WRITE,
    purpose: 'track one more competitor',
    payload: competitorCreate,
    async execute(trx, _config, actor, change, payload) {
      const competitor = await addCompetitor(trx, actor, change.projectId, payload);
      return { summary: `Now tracking ${competitor.name}.`, competitor: { id: competitor.id } };
    },
    preview(_context, payload) {
      return Promise.resolve({
        title: 'Track a competitor',
        rows: [
          { label: 'Name', value: payload.name },
          ...rowsOf('Also called', payload.aliases),
          ...rowsOf('Domain', payload.domains),
        ],
        spend: null,
        opens: null,
      });
    },
  }),
  review_competitor_suggestion: changeKind({
    permission: COMPETITORS_WRITE,
    purpose: 'accept (track it) or reject (hide it) one competitor suggestion',
    payload: z.strictObject({ suggestion_id: z.uuid(), decision: z.enum(['accept', 'reject']) }),
    async execute(trx, _config, actor, change, payload) {
      if (payload.decision === 'reject') {
        const rejected = await rejectSuggestion(
          trx,
          actor,
          change.projectId,
          payload.suggestion_id,
        );
        return { summary: `Rejected the suggestion ${rejected.name}.` };
      }
      const competitor = await acceptSuggestion(
        trx,
        actor,
        change.projectId,
        payload.suggestion_id,
      );
      return { summary: `Now tracking ${competitor.name}.`, competitor: { id: competitor.id } };
    },
    async preview(context, payload) {
      const suggestion = await suggestionRows(context.db, context)
        .select(['name', 'domain'])
        .where('id', '=', payload.suggestion_id)
        .executeTakeFirst();
      const name = suggestion?.domain ?? suggestion?.name ?? 'the suggestion';
      return {
        title:
          payload.decision === 'accept'
            ? 'Track a suggested competitor'
            : 'Hide a competitor suggestion',
        rows: [{ label: 'Competitor', value: name }],
        spend: null,
        opens: null,
      };
    },
  }),
  update_competitor: changeKind({
    permission: COMPETITORS_WRITE,
    purpose: 'rename a tracked competitor or replace its aliases or domains',
    payload: z.strictObject({ competitor_id: z.uuid(), ...competitorUpdate.shape }),
    async execute(trx, _config, actor, change, { competitor_id: id, ...update }) {
      const competitor = await updateCompetitor(trx, actor, change.projectId, id, update);
      return { summary: `Updated the competitor ${competitor.name}.` };
    },
    async preview(context, payload) {
      return {
        title: 'Update a competitor',
        rows: [
          { label: 'Competitor', value: await competitorName(context, payload.competitor_id) },
          ...rowsOf('Name', payload.name ? [payload.name] : []),
          ...replaced('Also called', payload.aliases),
          ...replaced('Domain', payload.domains),
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  remove_competitor: changeKind({
    permission: COMPETITORS_WRITE,
    purpose: 'stop tracking a competitor; earlier answers keep their text',
    payload: z.strictObject({ competitor_id: z.uuid() }),
    async execute(trx, _config, actor, change, payload) {
      await removeCompetitor(trx, actor, change.projectId, payload.competitor_id);
      return { summary: 'The competitor is no longer tracked.' };
    },
    async preview(context, payload) {
      return {
        title: 'Stop tracking a competitor',
        rows: [
          { label: 'Competitor', value: await competitorName(context, payload.competitor_id) },
          PERMANENT,
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  add_market: changeKind({
    permission: MEMBER_WRITE,
    purpose: 'add a market (country and language) that audits can run in',
    payload: projectMarketCreateSchema,
    async execute(trx, _config, actor, change, payload) {
      await addMarket(
        trx,
        { workspaceId: actor.workspaceId, projectId: change.projectId },
        payload,
      );
      return { summary: `Added the market ${payload.country_code}-${payload.language_code}.` };
    },
    preview(_context, payload) {
      return Promise.resolve({
        title: 'Add a market',
        rows: [
          { label: 'Country', value: payload.country_code },
          { label: 'Language', value: payload.language_code },
          ...rowsOf('Label', payload.label ? [payload.label] : []),
        ],
        spend: null,
        opens: null,
      });
    },
  }),
  remove_market: changeKind({
    permission: MEMBER_WRITE,
    purpose: 'remove an added market; schedules drop it and earlier audits stay',
    payload: z.strictObject({ market_id: z.uuid() }),
    async execute(trx, _config, actor, change, payload) {
      await deleteMarket(
        trx,
        { workspaceId: actor.workspaceId, projectId: change.projectId },
        payload.market_id,
      );
      return { summary: 'Removed the market.' };
    },
    async preview(context, payload) {
      const market = (await listMarkets(context.db, scopeOf(context))).find(
        (row) => row.id === payload.market_id,
      );
      const schedules = await countOf(
        context.db
          .selectFrom('audit_schedules')
          .select(ROW_COUNT)
          .where('workspace_id', '=', context.workspaceId)
          .where('project_id', '=', context.projectId)
          .where(sql<boolean>`market_ids @> jsonb_build_array(${payload.market_id}::text)`)
          .executeTakeFirst(),
      );
      return {
        title: 'Remove a market',
        rows: [
          { label: 'Market', value: market?.label ?? '' },
          { label: 'Audit schedules that drop it', value: String(schedules) },
          PERMANENT,
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  refresh_logos: changeKind({
    permission: MEMBER_WRITE,
    purpose: "fetch the brand's and competitors' logos again from their websites",
    payload: z.strictObject({}),
    async live(trx, _config, actor, change) {
      await readProject(trx, { workspaceId: actor.workspaceId, projectId: change.projectId });
    },
    async execute(db, config, actor, change) {
      await refreshProjectLogos(db, config.settings, {
        workspaceId: actor.workspaceId,
        projectId: change.projectId,
      });
      return { summary: 'Refreshed the logos.' };
    },
    preview() {
      return Promise.resolve({
        title: 'Refresh logos',
        rows: [{ label: 'From', value: 'The brand and competitor websites' }],
        spend: "One of the day's logo refreshes",
        opens: null,
      });
    },
  }),
};
