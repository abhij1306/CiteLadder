import { z } from 'zod';
import { notFound } from '../errors.ts';
import {
  createTheme,
  deleteTheme,
  listThemes,
  renameTheme,
  themeRequest,
} from '../projects/themes.ts';
import { mergeCategories } from '../perception/category-merge.ts';
import {
  changeKind,
  countOf,
  MEMBER_WRITE,
  PERMANENT,
  ROW_COUNT,
  type PreviewContext,
} from './kind.ts';

const PERCEPTION = { label: 'Open Perception', path: '/perception' };
const themePayload = z.strictObject({ theme_id: z.uuid() });

async function themeName(context: PreviewContext, id: string) {
  const theme = (await listThemes(context.db, context)).find((row) => row.id === id);
  if (!theme) throw notFound('Theme');
  return theme.name;
}

function probeAnswersIn(context: PreviewContext, themeId: string) {
  return countOf(
    context.db
      .selectFrom('probe_answer_items')
      .select(ROW_COUNT)
      .where('workspace_id', '=', context.workspaceId)
      .where('project_id', '=', context.projectId)
      .where('theme_id', '=', themeId)
      .executeTakeFirst(),
  );
}

export const themeKinds = {
  create_theme: changeKind({
    permission: MEMBER_WRITE,
    purpose: 'add a perception theme that probe answers are grouped under',
    payload: themeRequest,
    async execute(trx, _config, actor, change, payload) {
      const theme = await createTheme(
        trx,
        { workspaceId: actor.workspaceId, projectId: change.projectId },
        payload,
      );
      return { summary: `Added the theme “${theme.name}”.` };
    },
    preview(_context, payload) {
      return Promise.resolve({
        title: 'Add a theme',
        rows: [{ label: 'Theme', value: payload.name }],
        spend: null,
        opens: PERCEPTION,
      });
    },
  }),
  rename_theme: changeKind({
    permission: MEMBER_WRITE,
    purpose: 'rename a perception theme',
    payload: themePayload.extend(themeRequest.shape),
    async execute(trx, _config, actor, change, { theme_id: themeId, ...input }) {
      const theme = await renameTheme(
        trx,
        { workspaceId: actor.workspaceId, projectId: change.projectId, themeId },
        input,
      );
      return { summary: `Renamed the theme to “${theme.name}”.` };
    },
    async preview(context, payload) {
      return {
        title: 'Rename a theme',
        rows: [
          { label: 'Now', value: await themeName(context, payload.theme_id) },
          { label: 'After', value: payload.name },
        ],
        spend: null,
        opens: PERCEPTION,
      };
    },
  }),
  merge_themes: changeKind({
    permission: MEMBER_WRITE,
    purpose:
      'merge one perception theme into another; its labelled answers and probe answers move and it is deleted',
    payload: z.strictObject({ theme_id: z.uuid(), into_id: z.uuid() }),
    async execute(trx, _config, actor, change, payload) {
      const kept = await mergeCategories(trx, {
        workspaceId: actor.workspaceId,
        projectId: change.projectId,
        themeId: payload.theme_id,
        intoId: payload.into_id,
      });
      return { summary: `Merged into “${kept.name}”.` };
    },
    async preview(context, payload) {
      return {
        title: 'Merge themes',
        rows: [
          { label: 'Merge', value: await themeName(context, payload.theme_id) },
          { label: 'Into', value: await themeName(context, payload.into_id) },
          {
            label: 'Probe answers moved',
            value: String(await probeAnswersIn(context, payload.theme_id)),
          },
          PERMANENT,
        ],
        spend: null,
        opens: PERCEPTION,
      };
    },
  }),
  delete_theme: changeKind({
    permission: MEMBER_WRITE,
    purpose: 'delete a perception theme; probe answers filed under it are left without a theme',
    payload: themePayload,
    async execute(trx, _config, actor, change, payload) {
      await deleteTheme(trx, {
        workspaceId: actor.workspaceId,
        projectId: change.projectId,
        themeId: payload.theme_id,
      });
      return { summary: 'Deleted the theme.' };
    },
    async preview(context, payload) {
      return {
        title: 'Delete a theme',
        rows: [
          { label: 'Theme', value: await themeName(context, payload.theme_id) },
          {
            label: 'Probe answers left without a theme',
            value: String(await probeAnswersIn(context, payload.theme_id)),
          },
          PERMANENT,
        ],
        spend: null,
        opens: null,
      };
    },
  }),
};
