import { z } from 'zod';
import { jsonObject } from '../db/json.ts';
import { ApiError, notFound } from '../errors.ts';
import {
  newestOverrides,
  overrideVerdict,
  verdictOverrideRequest,
} from '../perception/verdict-overrides.ts';
import {
  brandFactCreate,
  brandFactUpdate,
  createBrandFact,
  updateBrandFact,
} from '../projects/brand-facts.ts';
import { brandProfileUpdate, updateBrandProfile } from '../projects/brand-profile.ts';
import { businessMapUpdate, readBusinessMap, updateBusinessMap } from '../projects/business-map.ts';
import { changeKind, MEMBER_WRITE, plural, rowsOf, type PreviewContext } from './kind.ts';

const CONTEXT = { label: 'Open Brand context', path: '/agent/context' };
const scopeOf = (workspaceId: string, change: { projectId: string }) => ({
  workspaceId,
  projectId: change.projectId,
});

function shown(value: unknown) {
  if (value === null || value === undefined || value === '') return 'empty';
  if (Array.isArray(value)) return value.join(', ') || 'none';
  return String(value);
}

async function currentProfile(context: PreviewContext): Promise<Record<string, unknown>> {
  const row = await context.db
    .selectFrom('brand_profiles')
    .select([
      'description',
      'positioning',
      'products_services',
      'target_audience',
      'business_context',
    ])
    .where('workspace_id', '=', context.workspaceId)
    .where('project_id', '=', context.projectId)
    .executeTakeFirst();
  if (!row) return {};
  const { business_context: business, ...fields } = row;
  return { ...jsonObject(business, 'brand_profiles.business_context'), ...fields };
}

async function fact(context: PreviewContext, id: string) {
  const row = await context.db
    .selectFrom('brand_facts')
    .select(['topic', 'statement', 'source_url', 'status', 'revision'])
    .where('workspace_id', '=', context.workspaceId)
    .where('project_id', '=', context.projectId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw notFound('Fact');
  return row;
}

async function claimVerdict(context: PreviewContext, id: string) {
  const row = await context.db
    .selectFrom('claim_verdicts as cv')
    .innerJoin('answer_claims as claim', (join) =>
      join
        .onRef('claim.id', '=', 'cv.claim_id')
        .onRef('claim.workspace_id', '=', 'cv.workspace_id'),
    )
    .innerJoin('fact_verifications as fv', (join) =>
      join
        .onRef('fv.id', '=', 'cv.verification_id')
        .onRef('fv.workspace_id', '=', 'cv.workspace_id'),
    )
    .innerJoin('audits', (join) =>
      join
        .onRef('audits.id', '=', 'fv.audit_id')
        .onRef('audits.workspace_id', '=', 'fv.workspace_id'),
    )
    .select(['cv.id', 'cv.verdict', 'cv.low_confidence', 'claim.claim'])
    .where('cv.workspace_id', '=', context.workspaceId)
    .where('audits.project_id', '=', context.projectId)
    .where('cv.id', '=', id)
    .executeTakeFirst();
  if (!row) throw notFound('Claim verdict');
  const override = (await newestOverrides(context.db, context.workspaceId, [row.id])).get(row.id);
  const model = row.low_confidence ? 'no verdict, low confidence' : row.verdict;
  return { claim: row.claim, model: row.verdict, shown: override?.verdict ?? model };
}

const factChange = z.strictObject({
  fact_id: z.uuid(),
  topic: brandFactUpdate.shape.topic,
  statement: brandFactUpdate.shape.statement,
  source_url: brandFactUpdate.shape.source_url,
  status: z.enum(['draft', 'retired']).optional(),
});

const offeringNames = (offerings: readonly { offering: string }[]) =>
  offerings.map((offering) => offering.offering).join(', ') || 'none';
const values = (entries: readonly { value: string }[]) =>
  entries.map((entry) => entry.value).join(', ') || 'none';
const offeringDetail = (offering: z.output<typeof businessMapUpdate>['offerings'][number]) =>
  [
    `attributes ${values(offering.attributes)}`,
    `situations ${values(offering.situations)}`,
    `audiences ${values(offering.audiences)}`,
    `exclusions ${offering.exclusions.map((pair) => `${pair.first} / ${pair.second}`).join(', ') || 'none'}`,
  ].join('; ');

export const brandKinds = {
  update_brand_profile: changeKind({
    permission: MEMBER_WRITE,
    purpose: 'change brand profile fields to what the person said; fields left out stay',
    payload: brandProfileUpdate,
    async execute(trx, _config, actor, change, payload) {
      await updateBrandProfile(trx, scopeOf(actor.workspaceId, change), actor.userId, payload);
      return { summary: 'Updated the brand profile.' };
    },
    async preview(context, payload) {
      const current = await currentProfile(context);
      const fields = Object.entries(payload).filter(([, value]) => value != null);
      if (!fields.length) throw new ApiError(422, 'An edit changes at least one field');
      return {
        title: `Change ${plural(fields.length, 'brand profile field')}`,
        rows: fields.map(([field, value]) => ({
          label: field.replaceAll('_', ' '),
          value: `${shown(current[field])} → ${shown(value)}`,
        })),
        spend: null,
        opens: CONTEXT,
      };
    },
  }),
  update_business_map: changeKind({
    permission: MEMBER_WRITE,
    purpose: 'replace the whole business map; offerings left out are removed',
    payload: businessMapUpdate,
    async execute(trx, _config, actor, change, payload) {
      const map = await updateBusinessMap(
        trx,
        scopeOf(actor.workspaceId, change),
        actor.userId,
        payload,
      );
      return {
        summary: `Saved the business map with ${plural(map.offerings.length, 'offering')}.`,
      };
    },
    async preview(context, payload) {
      const now = await readBusinessMap(context.db, context);
      return {
        title: 'Replace the business map',
        rows: [
          { label: 'Offerings now', value: offeringNames(now.offerings) },
          ...(payload.offerings.length
            ? payload.offerings.map((offering) => ({
                label: offering.offering,
                value: offeringDetail(offering),
              }))
            : [{ label: 'Offerings after', value: 'None: all are removed' }]),
        ],
        spend: null,
        opens: CONTEXT,
      };
    },
  }),
  create_brand_fact: changeKind({
    permission: MEMBER_WRITE,
    purpose:
      'add a company fact for fact checking, only from what the person said or attached; it lands as a draft the person reviews',
    payload: brandFactCreate,
    async execute(trx, _config, actor, change, payload) {
      await createBrandFact(trx, scopeOf(actor.workspaceId, change), actor.userId, payload);
      return { summary: 'Added the fact as a draft.' };
    },
    preview(_context, payload) {
      return Promise.resolve({
        title: 'Add a fact as a draft',
        rows: [
          { label: 'Topic', value: payload.topic.replaceAll('_', ' ') },
          { label: 'Fact', value: payload.statement },
          ...(payload.source_url ? [{ label: 'Source', value: payload.source_url }] : []),
          { label: 'Status', value: 'Draft, for you to review' },
        ],
        spend: null,
        opens: null,
      });
    },
  }),
  update_brand_fact: changeKind({
    permission: MEMBER_WRITE,
    purpose:
      'correct a company fact (topic, statement, source) with what the person said, or retire it (status retired); never confirms a fact',
    payload: factChange.extend({ expected_revision: brandFactUpdate.shape.expected_revision }),
    draft: {
      schema: factChange,
      complete: async (context, draft) => ({
        ...draft,
        expected_revision: (await fact(context, draft.fact_id)).revision,
      }),
    },
    async execute(trx, _config, actor, change, { fact_id: factId, ...update }) {
      await updateBrandFact(trx, scopeOf(actor.workspaceId, change), actor.userId, factId, update);
      return { summary: update.status === 'retired' ? 'Retired the fact.' : 'Updated the fact.' };
    },
    async preview(context, payload) {
      const now = await fact(context, payload.fact_id);
      const changed = (['topic', 'statement', 'source_url', 'status'] as const).flatMap((field) =>
        payload[field] === undefined || payload[field] === now[field]
          ? []
          : [
              {
                label: field.replace('_url', ''),
                value: `${shown(now[field])} → ${shown(payload[field])}`,
              },
            ],
      );
      return {
        title: payload.status === 'retired' ? 'Retire a fact' : 'Correct a fact',
        rows: [{ label: 'Fact', value: now.statement }, ...changed],
        spend: null,
        opens: null,
      };
    },
  }),
  override_claim_verdict: changeKind({
    permission: MEMBER_WRITE,
    purpose:
      "set a fact-check claim's verdict to the person's judgement, with their note; the model's verdict stays recorded",
    payload: z.strictObject({ verdict_id: z.uuid(), ...verdictOverrideRequest.shape }),
    async execute(trx, _config, actor, change, { verdict_id: verdictId, ...overridden }) {
      const saved = await overrideVerdict(trx, {
        scope: scopeOf(actor.workspaceId, change),
        userId: actor.userId,
        verdictId,
        change: overridden,
      });
      return { summary: `The claim now reads ${saved.verdict}.` };
    },
    async preview(context, payload) {
      const verdict = await claimVerdict(context, payload.verdict_id);
      return {
        title: 'Override a claim verdict',
        rows: [
          { label: 'Claim', value: verdict.claim },
          { label: 'Model verdict', value: verdict.model.replaceAll('_', ' ') },
          { label: 'Now', value: verdict.shown.replaceAll('_', ' ') },
          { label: 'After', value: payload.verdict.replaceAll('_', ' ') },
          ...rowsOf('Note', payload.note ? [payload.note] : []),
        ],
        spend: null,
        opens: null,
      };
    },
  }),
};
