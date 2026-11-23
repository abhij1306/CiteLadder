import { searchCitationMatchRequestSchema } from '@citeladder/contracts/search-intelligence-requests';
import { z } from 'zod';
import { policy, type ServiceConfig } from '../config.ts';
import { resolveSettingSpec } from '../config/settings.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { ApiError, notFound } from '../errors.ts';
import { preferencesBody, reviewBody } from '../routes/search-intelligence-contracts.ts';
import { deriveCitationMatches } from '../search-intelligence/citations.ts';
import { createReview } from '../search-intelligence/reviews.ts';
import { cancelRun, confirmRun, savePreferences } from '../search-intelligence/runs.ts';
import { changeKind, MEMBER_RUN, MEMBER_WRITE, plural, type PreviewContext } from './kind.ts';

type Scope = Readonly<{ workspaceId: string; projectId: string }>;

const RESEARCH = { label: 'Open Keyword research', path: '/search-intelligence' };
const FINISHED = ['succeeded', 'failed', 'cancelled', 'partial', 'uncertain'];
const research = (scope: Scope) => ({
  workspace: new WorkspaceScope(scope.workspaceId),
  projectId: scope.projectId,
});
const encryptionKey = (config: ServiceConfig) =>
  String(resolveSettingSpec(policy.settings.encryption_key, config.settings));
const runPayload = z.strictObject({ run_id: z.uuid() });

async function projectRun(context: PreviewContext, runId: string) {
  const run = await context.db
    .selectFrom('search_intelligence_runs')
    .selectAll()
    .where('workspace_id', '=', context.workspaceId)
    .where('project_id', '=', context.projectId)
    .where('id', '=', runId)
    .executeTakeFirst();
  if (!run) throw notFound('Run');
  return run;
}

async function competitorNames(context: PreviewContext, ids: readonly string[]) {
  if (!ids.length) return [];
  const rows = await context.db
    .selectFrom('competitors')
    .select('name')
    .where('workspace_id', '=', context.workspaceId)
    .where('project_id', '=', context.projectId)
    .where('id', 'in', ids)
    .orderBy('name')
    .execute();
  return rows.map((row) => row.name);
}

function runSpend(run: Awaited<ReturnType<typeof projectRun>>) {
  if (run.planned_calls === 0) return 'Nothing: every dataset is reused from a recent run';
  if (run.credential_source === 'platform') return plural(run.estimated_credits ?? 0, 'AI credit');
  return `${plural(run.planned_calls, 'DataForSEO call')} on your own DataForSEO key, about $${Number(run.estimated_cost_usd).toFixed(2)}`;
}

const started = (run: { created_at: Date }) => ({
  label: 'Reviewed',
  value: run.created_at.toISOString().slice(0, 16),
});

export const researchKinds = {
  create_keyword_review: changeKind({
    permission: MEMBER_RUN,
    purpose: 'quote a Keyword research run; spends nothing, and only confirm_keyword_run starts it',
    payload: reviewBody,
    async live(trx, config, actor, change, payload) {
      await createReview(
        trx,
        research({ workspaceId: actor.workspaceId, projectId: change.projectId }),
        actor.userId,
        change.id,
        payload,
        encryptionKey(config),
        { resolve: (target) => Promise.resolve(target) },
      );
    },
    async execute(db, config, actor, change, payload) {
      const run = await createReview(
        db,
        research({ workspaceId: actor.workspaceId, projectId: change.projectId }),
        actor.userId,
        change.id,
        payload,
        encryptionKey(config),
      );
      return {
        summary: `Quoted the Keyword research run: ${run.planned_calls} calls. Nothing is spent until it is confirmed.`,
        run: { id: run.id },
      };
    },
    async preview(context, payload) {
      const competitors = await competitorNames(
        context,
        payload.datasets.flatMap((item) => (item.competitor_id ? [item.competitor_id] : [])),
      );
      return {
        title: `Quote Keyword research for ${plural(payload.datasets.length, 'dataset')}`,
        rows: [
          {
            label: 'Datasets',
            value: [
              ...new Set(payload.datasets.map((item) => item.kind.replaceAll('_', ' '))),
            ].join(', '),
          },
          ...(competitors.length ? [{ label: 'Competitors', value: competitors.join(', ') }] : []),
          { label: 'Spend', value: 'Nothing until the quoted run is confirmed' },
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  confirm_keyword_run: changeKind({
    permission: MEMBER_RUN,
    purpose:
      'start a quoted Keyword research run; holds its AI credits (or uses the workspace DataForSEO key) when confirmed',
    payload: runPayload,
    async execute(trx, _config, actor, change, payload) {
      const run = await confirmRun(
        trx,
        research({ workspaceId: actor.workspaceId, projectId: change.projectId }),
        payload.run_id,
      );
      return {
        summary: 'Started the Keyword research run. It runs on its own.',
        run: { id: run.id },
      };
    },
    async preview(context, payload) {
      const run = await projectRun(context, payload.run_id);
      if (run.confirmed_at) throw new ApiError(409, 'This run was already confirmed');
      return {
        title: 'Start a Keyword research run',
        rows: [
          started(run),
          { label: 'Provider calls', value: String(run.planned_calls) },
          { label: 'Rows', value: String(run.planned_rows) },
        ],
        spend: runSpend(run),
        opens: RESEARCH,
      };
    },
  }),
  cancel_keyword_run: changeKind({
    permission: MEMBER_RUN,
    purpose: 'stop a queued or running Keyword research run; rows already saved are kept',
    payload: runPayload,
    async execute(trx, _config, actor, change, payload) {
      await cancelRun(
        trx,
        research({ workspaceId: actor.workspaceId, projectId: change.projectId }),
        payload.run_id,
      );
      return { summary: 'The Keyword research run was cancelled.' };
    },
    async preview(context, payload) {
      const run = await projectRun(context, payload.run_id);
      if (FINISHED.includes(run.status)) throw new ApiError(409, 'This run already finished');
      return {
        title: 'Cancel a Keyword research run',
        rows: [started(run), { label: 'Status', value: run.status }],
        spend: null,
        opens: null,
      };
    },
  }),
  save_keyword_preferences: changeKind({
    permission: MEMBER_WRITE,
    purpose:
      'save the Keyword research defaults: research scope, owned site, competitors, market, reuse of recent data and list depths',
    payload: preferencesBody,
    async execute(trx, _config, actor, change, payload) {
      await savePreferences(
        trx,
        research({ workspaceId: actor.workspaceId, projectId: change.projectId }),
        payload,
      );
      return { summary: 'Saved the Keyword research defaults.' };
    },
    async preview(context, payload) {
      const competitors = await competitorNames(context, payload.competitor_ids);
      return {
        title: 'Save Keyword research defaults',
        rows: [
          { label: 'Research scope', value: payload.research_scope.replaceAll('_', ' ') },
          { label: 'Competitors', value: competitors.join(', ') || 'None' },
          {
            label: 'Market',
            value: `${payload.location_code ?? 'project'} · ${payload.language_code || 'project'}`,
          },
          { label: 'Reuse recent data', value: payload.reuse_recent ? 'Yes' : 'No' },
        ],
        spend: null,
        opens: null,
      };
    },
  }),
  derive_citation_matches: changeKind({
    permission: MEMBER_WRITE,
    purpose:
      'match a published referring-domain dataset against the citations of chosen audits, saved as a new dataset',
    payload: searchCitationMatchRequestSchema,
    async execute(trx, _config, actor, change, payload) {
      const dataset = await deriveCitationMatches(
        trx,
        research({ workspaceId: actor.workspaceId, projectId: change.projectId }),
        payload.backlink_dataset_id,
        payload.audit_ids,
      );
      return {
        summary: `Saved ${plural(dataset.unique_rows_saved, 'citation match', 'citation matches')}.`,
        matches: dataset.unique_rows_saved,
      };
    },
    async preview(_context, payload, rehearse) {
      const { matches } = await rehearse();
      return {
        title: 'Match referring domains to cited sources',
        rows: [
          { label: 'Audits', value: String(payload.audit_ids.length) },
          { label: 'Matches', value: String(matches) },
        ],
        spend: null,
        opens: null,
      };
    },
  }),
};
