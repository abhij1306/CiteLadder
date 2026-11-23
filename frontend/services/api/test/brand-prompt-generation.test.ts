import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { policy } from '../src/config.ts';
import type { JevClient } from '../src/models/jev.ts';
import { promptCandidates } from '../src/mcp/evidence-prompt-setup.ts';
import { reviewCandidates } from '../src/prompts/candidates.ts';
import { generationInput } from '../src/prompts/generation-input.ts';
import { generatePrompts } from '../src/prompts/generation.ts';
import {
  echoDependencies,
  prompt,
  promptSet,
  topic,
  type DraftRequest,
} from './prompt-fixtures.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures, type Tenant } from './visibility-fixtures.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db);
let tenant: Tenant, setId: string;

const ANGLE_WORDS: Record<string, string> = {
  recommend_for_need: 'Would you recommend',
  pros_and_cons: 'Pros and cons of',
  reasons_not_to_choose: 'Why do buyers skip',
  worth_the_price: 'Are these worth the money:',
  reviews: 'What do reviews say about',
};

function write(slot: DraftRequest['slots'][number]) {
  const need = slot.buyer_need as Record<string, string>;
  const angle = need.angle ?? '';
  if (need.competitor)
    return {
      text: `Acme vs ${need.competitor} running shoes for ${slot.slot_id}style runners`,
      prompt_intent: 'compare',
    };
  const who = need.audience ? ` for ${need.audience}` : '';
  return {
    text: `${ANGLE_WORDS[angle]} Acme running shoes${who} ${slot.slot_id}style`,
    prompt_intent: angle === 'recommend_for_need' ? 'recommend' : 'validate',
  };
}

async function businessProfile(topicId: string) {
  const brand = await db
    .selectFrom('brands')
    .select('id')
    .where('project_id', '=', tenant.projectId)
    .executeTakeFirstOrThrow();
  const now = new Date();
  await db
    .insertInto('brand_profiles')
    .values({
      id: randomUUID(),
      workspace_id: tenant.workspaceId,
      project_id: tenant.projectId,
      brand_id: brand.id,
      business_context: JSON.stringify({
        category_terms: ['running shoes'],
        topic_offerings: { [topicId]: ['Trail running shoes'] },
        business_map: {
          offerings: [
            {
              offering: 'Trail running shoes',
              attributes: [],
              situations: [],
              audiences: [
                {
                  value: 'marathon beginners',
                  origin: 'manual',
                  review_state: 'confirmed',
                  reviewed_by: null,
                  reviewed_at: null,
                  source: {},
                },
              ],
              exclusions: [],
            },
          ],
        },
      }),
      description: '',
      positioning: '',
      target_audience: '',
      products_services: JSON.stringify(['Trail running shoes']),
      sources: JSON.stringify({}),
      source_artifact_ids: '{}',
      created_at: now,
      updated_at: now,
    })
    .execute();
}

beforeEach(async () => {
  tenant = await fixtures.tenant();
  await fixtures.brand(tenant.projectId, 'Acme');
  setId = await promptSet(db, tenant.projectId);
  await businessProfile(await topic(db, tenant.projectId, 'Running shoes'));
});
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

const judgedState = z.object({ candidate: z.object({ question: z.string() }) });
const brandRequest = (count: number) => generationInput.parse({ mode: 'brand', count });
const pendingTexts = async () =>
  (
    await db
      .selectFrom('prompt_candidates')
      .select('text')
      .where('prompt_set_id', '=', setId)
      .where('disposition', '=', 'pending')
      .execute()
  ).map((row) => row.text);

describe('brand prompt generation at the PostgreSQL boundary', () => {
  it('stages evaluation candidates grounded in offerings and tracked competitors, counted against prompt slots on accept', async () => {
    await fixtures.competitor(tenant.projectId, { name: 'Strider' });
    const requests: DraftRequest[] = [];
    const result = await generatePrompts(
      db,
      tenant.workspaceId,
      setId,
      brandRequest(6),
      echoDependencies({ write, onRequest: (sent) => requests.push(sent) }),
    );
    const staged = await db
      .selectFrom('prompt_candidates')
      .select(['text', 'intent', 'cohort', 'prompt_intent'])
      .where('prompt_set_id', '=', setId)
      .where('disposition', '=', 'pending')
      .orderBy('text')
      .execute();
    expect(staged).toEqual([
      {
        text: 'Acme vs Strider running shoes for q3style runners',
        intent: 'evaluation',
        cohort: 'comparison',
        prompt_intent: 'compare',
      },
      {
        text: 'Are these worth the money: Acme running shoes q5style',
        intent: 'evaluation',
        cohort: 'brand_diagnostic',
        prompt_intent: 'validate',
      },
      {
        text: 'Pros and cons of Acme running shoes q2style',
        intent: 'evaluation',
        cohort: 'brand_diagnostic',
        prompt_intent: 'validate',
      },
      {
        text: 'What do reviews say about Acme running shoes q6style',
        intent: 'evaluation',
        cohort: 'brand_diagnostic',
        prompt_intent: 'validate',
      },
      {
        text: 'Why do buyers skip Acme running shoes q4style',
        intent: 'evaluation',
        cohort: 'brand_diagnostic',
        prompt_intent: 'validate',
      },
      {
        text: 'Would you recommend Acme running shoes for marathon beginners q1style',
        intent: 'evaluation',
        cohort: 'brand_diagnostic',
        prompt_intent: 'recommend',
      },
    ]);
    const comparison = requests.find((sent) => sent.slots[0]?.cohort === 'comparison');
    expect(comparison?.reference).toMatchObject({
      brand_name: 'Acme',
      competitors: ['Strider'],
      offerings: ['Trail running shoes'],
    });
    expect(requests[0]?.system).toContain('size up one business before buying from it');

    const read = {
      db,
      scope: { workspaceId: tenant.workspaceId, projectId: tenant.projectId },
      origin: 'https://app.test',
    };
    const listed = async (intent: string) =>
      ((await promptCandidates(read, { intent })).items as unknown[]).length;
    expect([await listed('evaluation'), await listed('discovery')]).toEqual([6, 0]);

    const ids = result.candidates.map((row) => row.id);
    const scope = { workspaceId: tenant.workspaceId, projectId: tenant.projectId };
    await reviewCandidates(db, scope, setId, { accept_ids: ids.slice(0, 2), reject_ids: [] });
    const tracked = await db
      .selectFrom('prompts')
      .select(['intent', 'branded'])
      .where('prompt_set_id', '=', setId)
      .execute();
    expect(tracked).toEqual([
      { intent: 'evaluation', branded: true },
      { intent: 'evaluation', branded: true },
    ]);
  });

  it('plans no comparison prompt for a project without a tracked competitor', async () => {
    const requests: DraftRequest[] = [];
    const result = await generatePrompts(
      db,
      tenant.workspaceId,
      setId,
      brandRequest(5),
      echoDependencies({ write, onRequest: (sent) => requests.push(sent) }),
    );
    expect(result.candidates.map((row) => row.cohort)).toEqual(Array(5).fill('brand_diagnostic'));
    const angles = requests.flatMap((sent) =>
      sent.slots.map((slot) => (slot.buyer_need as Record<string, string>).angle),
    );
    expect(new Set(angles)).toEqual(new Set(Object.keys(ANGLE_WORDS)));
  });

  it('refuses another workspace, too many at once and a full project before any model call', async () => {
    const other = await fixtures.tenant();
    const deps = echoDependencies({ write });
    await expect(
      generatePrompts(db, other.workspaceId, setId, brandRequest(5), deps),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      generatePrompts(db, tenant.workspaceId, setId, brandRequest(11), deps),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      generatePrompts(
        db,
        tenant.workspaceId,
        setId,
        generationInput.parse({ mode: 'brand', count: 2, seed_source: 'search_console' }),
        deps,
      ),
    ).rejects.toMatchObject({ status: 422 });
    const filled = await Promise.all(
      Array.from({ length: 26 }, (_, index) => prompt(db, setId, `Acme question ${index}`)),
    );
    await db
      .updateTable('prompts')
      .set({ intent: 'evaluation' })
      .where('id', 'in', filled)
      .execute();
    await expect(
      generatePrompts(db, tenant.workspaceId, setId, brandRequest(5), deps),
    ).rejects.toMatchObject({
      status: 422,
      message: 'This project has room for 4 more brand prompts (at most 30)',
    });
    expect(deps.io.fetch).not.toHaveBeenCalled();
    await generatePrompts(db, tenant.workspaceId, setId, brandRequest(4), deps);
    expect(deps.io.fetch).toHaveBeenCalled();
  });

  it('gates a brand draft that states a fact about the brand, comparisons included', async () => {
    await fixtures.competitor(tenant.projectId, { name: 'Strider' });
    const STATED = /cheaper|so slow/;
    const judged: { question: string; claims: boolean }[] = [];
    const judge: JevClient = {
      model: 'jev-test',
      decide: async (state, questions) => {
        const question = judgedState.parse(state).candidate.question;
        judged.push({ question, claims: 'grounded_claims' in questions });
        const answers = Object.fromEntries(
          Object.keys(questions)
            .filter((key) => (questions[key] as { type: string }).type === 'noul')
            .map((key) => [
              key,
              { noul: key === 'grounded_claims' && STATED.test(question) ? 0.05 : 0.9 },
            ]),
        );
        return { model: 'jev-test', answers };
      },
    };
    const leading = (slot: DraftRequest['slots'][number]) => {
      const need = slot.buyer_need as Record<string, string>;
      if (need.competitor)
        return {
          text: `Why is Acme cheaper than ${need.competitor} running shoes ${slot.slot_id}style`,
          prompt_intent: 'compare',
        };
      if (need.angle === 'reasons_not_to_choose')
        return {
          text: `Why are Acme running shoes so slow to dry ${slot.slot_id}style`,
          prompt_intent: 'validate',
        };
      return write(slot);
    };
    await generatePrompts(db, tenant.workspaceId, setId, brandRequest(6), {
      ...echoDependencies({ write: leading }),
      judge: () => judge,
    });
    const staged = await pendingTexts();
    expect({
      staged: staged.length,
      stated: staged.filter((text) => STATED.test(text)),
      comparisonsJudgedForClaims: judged
        .filter(({ question }) => question.includes('Strider'))
        .every(({ claims }) => claims),
      judgedStated: judged
        .filter(({ question }) => STATED.test(question))
        .map(({ question }) => question.split(' ')[3])
        .toSorted(),
    }).toEqual({
      staged: 4,
      stated: [],
      comparisonsJudgedForClaims: true,
      judgedStated: ['cheaper', 'running'],
    });
  });

  it('holds the per-project cap when two brand requests race for the last room', async () => {
    const filled = await Promise.all(
      Array.from({ length: policy.prompts.brand.max_per_project - 4 }, (_, index) =>
        prompt(db, setId, `Acme question ${index}`),
      ),
    );
    await db
      .updateTable('prompts')
      .set({ intent: 'evaluation' })
      .where('id', 'in', filled)
      .execute();
    await Promise.all([
      generatePrompts(db, tenant.workspaceId, setId, brandRequest(4), echoDependencies({ write })),
      generatePrompts(
        db,
        tenant.workspaceId,
        setId,
        brandRequest(4),
        echoDependencies({
          write: (slot) => ({ ...write(slot), text: `${write(slot).text} again` }),
        }),
      ),
    ]);
    expect(await pendingTexts()).toHaveLength(4);
  });
});
