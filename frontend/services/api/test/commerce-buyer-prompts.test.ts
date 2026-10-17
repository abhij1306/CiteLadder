import { afterAll, beforeEach, expect, it, vi } from 'vitest';

import {
  buyerGenerateInput,
  buyerManualInput,
  generateBuyerPrompts,
  manualBuyerPrompt,
} from '../src/commerce/buyer-prompts.ts';
import { importCatalog } from '../src/commerce/import.ts';
import { createModelGateway, gatewaySettings } from '../src/models/gateway.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';

const db = testDatabase(),
  fixtures = new VisibilityFixtures(db);
let scope: { workspaceId: string; projectId: string }, target: { kind: 'product'; id: string };
beforeEach(async () => {
  scope = await fixtures.tenant();
  await importCatalog(db, scope, {
    content:
      'canonical_url,name,description\nhttps://shop.test/shoes,Trail master,Running shoes for wet trails\n',
    filename: 'catalog.csv',
    content_type: 'text/csv',
  });
  const product = await db
    .selectFrom('commerce_products')
    .select('id')
    .where('project_id', '=', scope.projectId)
    .executeTakeFirstOrThrow();
  target = { kind: 'product', id: product.id };
});
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

it('saves manual prompts disabled', async () => {
  await expect(
    manualBuyerPrompt(
      db,
      scope,
      buyerManualInput.parse({ target, text: 'Which shoes grip rain?' }),
    ),
  ).resolves.toMatchObject({ enabled: false, approved_at: null, target });
});

it('generates target-bound prompts and fails atomically on unusable or foreign targets', async () => {
  const io = {
    fetch: vi.fn<typeof fetch>(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                prompts: [
                  { text: 'best running shoes for wet trails' },
                  { text: 'lightweight shoes with cushioning for long runs' },
                ],
              }),
            },
          },
        ],
      }),
    ),
    sleep: async () => {},
  };
  const gateway = () =>
    createModelGateway(
      {
        ...gatewaySettings({}),
        apiKey: 'test-only',
        model: 'claude-haiku-5-5',
        baseUrl: 'https://model.test',
      },
      io,
    );
  const rows = await generateBuyerPrompts(
    db,
    scope,
    buyerGenerateInput.parse({ targets: [target], count: 2 }),
    gateway,
  );
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => !row.enabled)).toBe(true);
  const other = await fixtures.tenant();
  await expect(
    generateBuyerPrompts(
      db,
      other,
      buyerGenerateInput.parse({ targets: [target], count: 2 }),
      gateway,
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect(io.fetch).toHaveBeenCalledTimes(1);
  io.fetch.mockImplementationOnce(async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({ prompts: [{ text: 'What do you prefer in Trail master?' }] }),
          },
        },
      ],
    }),
  );
  await expect(
    generateBuyerPrompts(
      db,
      scope,
      buyerGenerateInput.parse({ targets: [target], count: 2 }),
      gateway,
    ),
  ).rejects.toMatchObject({ status: 503 });
  expect(
    await db
      .selectFrom('commerce_prompt_targets')
      .select('id')
      .where('project_id', '=', scope.projectId)
      .execute(),
  ).toHaveLength(2);
  io.fetch.mockImplementationOnce(async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              prompts: [
                { text: 'best running shoes for wet trails' },
                { text: 'waterproof trail shoes for muddy hikes' },
                // Binds only through the plural fold: "shoe" meets "shoes".
                { text: 'best waterproof shoe for rainy commutes' },
              ],
            }),
          },
        },
      ],
    }),
  );
  const repeat = await generateBuyerPrompts(
    db,
    scope,
    buyerGenerateInput.parse({ targets: [target], count: 2 }),
    gateway,
  );
  expect(repeat.map((row) => row.text)).toEqual([
    'waterproof trail shoes for muddy hikes',
    'best waterproof shoe for rainy commutes',
  ]);
});

it("keeps each target's usable prompts and binds category prompts through the category's own name", async () => {
  await importCatalog(db, scope, {
    content: 'canonical_url,name,category\nhttps://shop.test/shell,Storm shell,Rain jackets\n',
    filename: 'jackets.csv',
    content_type: 'text/csv',
  });
  const category = await db
    .selectFrom('commerce_categories')
    .select('id')
    .where('project_id', '=', scope.projectId)
    .where('normalized_name', '=', 'rain jackets')
    .executeTakeFirstOrThrow();
  const answers = [
    // Binds only through the category name: no product or term says "jacket".
    ['cheap rain jacket that packs small for cycling'],
    // Every prompt for the product is unusable.
    ['What do you prefer in Trail master?'],
  ];
  const io = {
    fetch: vi.fn<typeof fetch>(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                prompts: (answers.shift() ?? []).map((text) => ({ text })),
              }),
            },
          },
        ],
      }),
    ),
    sleep: async () => {},
  };
  const gateway = () =>
    createModelGateway(
      {
        ...gatewaySettings({}),
        apiKey: 'test-only',
        model: 'claude-haiku-5-5',
        baseUrl: 'https://model.test',
      },
      io,
    );
  const rows = await generateBuyerPrompts(
    db,
    scope,
    buyerGenerateInput.parse({
      targets: [{ kind: 'category', id: category.id }, target],
      count: 2,
    }),
    gateway,
  );
  expect(rows.map((row) => [row.target.kind, row.text])).toEqual([
    ['category', 'cheap rain jacket that packs small for cycling'],
  ]);
});
