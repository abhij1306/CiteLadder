import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { mergeCategories } from '../src/perception/category-merge.ts';
import { aspect, CONFIGURATION, perceptionReads, type Body } from './perception-read-fixtures.ts';
import type { Tenant } from './visibility-fixtures.ts';

const { db, fixtures, get, answer, themes } = perceptionReads();

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

describe('perception categories', () => {
  it('groups attributes by category, tells category-only labels from no attribute, and carries a merge to past labels in this workspace only', async () => {
    const owner = await fixtures.tenant();
    const stranger = await fixtures.tenant();
    const [refunds, returns, theirs] = [randomUUID(), randomUUID(), randomUUID()];
    await themes(owner, [
      [refunds, 'Refunds'],
      [returns, 'Returns'],
    ]);
    await themes(stranger, [[theirs, 'Refunds']]);
    const run = await fixtures.audit(owner, { configuration: CONFIGURATION });
    await answer(owner, run, {
      outcome: 'classified',
      entities: [
        {
          name: 'Acme',
          kind: 'brand',
          label: 'negative',
          aspects: [
            {
              ...aspect('negative', 'refunds take weeks'),
              theme_id: refunds,
              attribute: 'Slow refunds',
            },
            { ...aspect('negative', 'returns are hard'), theme_id: returns, attribute: null },
            { ...aspect('negative', 'old label'), theme_id: returns },
          ],
        },
        {
          name: 'Rival',
          kind: 'competitor',
          label: 'negative',
          aspects: [
            {
              ...aspect('negative', 'Rival refunds lag'),
              theme_id: returns,
              attribute: 'Slow refunds',
            },
          ],
        },
      ],
    });
    const strangerRun = await fixtures.audit(stranger, { configuration: CONFIGURATION });
    await answer(stranger, strangerRun, {
      outcome: 'classified',
      entities: [
        {
          name: 'Acme',
          kind: 'brand',
          label: 'negative',
          aspects: [
            { ...aspect('negative', 'forged'), theme_id: returns, attribute: 'Slow refunds' },
          ],
        },
      ],
    });
    const read = async (tenant: Tenant, auditId: string) => {
      const { body } = await get(
        tenant,
        `/api/v1/projects/${tenant.projectId}/visibility/perception`,
        { audit_id: auditId },
      );
      return {
        categories: (body.entities as Body[]).map((entity) => [
          entity.name,
          (entity.categories as Body[]).map((row) => [
            row.category,
            row.mentions,
            row.negative,
            (row.attributes as Body[]).map((item) => [
              item.attribute,
              item.negative,
              (item.quotes as Body[]).map((quote) => quote.text),
            ]),
          ]),
        ]),
        quotes: (body.themes as Body[]).flatMap((theme) =>
          (theme.quotes as Body[]).map((quote) => [theme.theme, quote.text, quote.attribute]),
        ),
      };
    };
    expect(await read(owner, run)).toEqual({
      categories: [
        [
          'Acme',
          [
            ['Returns', 1, 2, []],
            ['Refunds', 1, 1, [['Slow refunds', 1, ['refunds take weeks']]]],
          ],
        ],
        ['Rival', [['Returns', 1, 1, [['Slow refunds', 1, []]]]]],
      ],
      quotes: [
        ['Returns', 'returns are hard', { kind: 'not_found' }],
        ['Returns', 'old label', { kind: 'not_labelled' }],
        ['Refunds', 'refunds take weeks', { kind: 'labelled', name: 'Slow refunds' }],
      ],
    });
    await expect(
      mergeCategories(db, {
        workspaceId: stranger.workspaceId,
        projectId: stranger.projectId,
        themeId: returns,
        intoId: theirs,
      }),
    ).rejects.toThrow('Theme not found');
    await mergeCategories(db, {
      workspaceId: owner.workspaceId,
      projectId: owner.projectId,
      themeId: returns,
      intoId: refunds,
    });
    expect((await read(owner, run)).categories).toEqual([
      ['Acme', [['Refunds', 1, 3, [['Slow refunds', 1, ['refunds take weeks']]]]]],
      ['Rival', [['Refunds', 1, 1, [['Slow refunds', 1, []]]]]],
    ]);
    const forged = await db
      .selectFrom('entity_sentiments')
      .select('aspects')
      .where('workspace_id', '=', stranger.workspaceId)
      .executeTakeFirstOrThrow();
    expect(forged.aspects).toEqual([expect.objectContaining({ theme_id: returns })]);
  });
});
