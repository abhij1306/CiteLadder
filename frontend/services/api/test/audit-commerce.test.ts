import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { freezeCommerceContext } from '../src/commerce/audit-context.ts';
import { addMembership, categoryByName, newProduct } from '../src/commerce/catalog-store.ts';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { prompt, promptSet } from './prompt-fixtures.ts';

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});
async function seed() {
  const t = await fixtures.tenant();
  const scope = { workspaceId: t.workspaceId, projectId: t.projectId };
  const promptId = await prompt(
    db,
    await promptSet(db, t.projectId),
    'Which tools suit beginners?',
  );
  const category = await categoryByName(db, scope, 'Tools');
  const product = await newProduct(db, scope, 'https://shop.example/products/tool');
  await db
    .updateTable('commerce_products')
    .set({ name: 'Small drill', price: '12.50' })
    .where('id', '=', product.id)
    .execute();
  await addMembership(db, scope, product.id, category.id, null);
  const targetId = randomUUID();
  await db
    .insertInto('commerce_prompt_targets')
    .values({
      id: targetId,
      workspace_id: t.workspaceId,
      project_id: t.projectId,
      prompt_id: promptId,
      target_kind: 'category',
      target_id: category.id,
      template_version: 'test',
      approved_at: new Date(),
      created_at: new Date(),
    })
    .execute();
  return { ...t, scope, promptId, productId: product.id, categoryId: category.id, targetId };
}
describe('frozen Commerce audit evidence', () => {
  it('freezes active shelf evidence and only reviewed competitors before later catalog edits', async () => {
    const t = await seed();
    for (const state of ['approved', 'proposed'])
      await db
        .insertInto('commerce_competitor_candidates')
        .values({
          id: randomUUID(),
          workspace_id: t.workspaceId,
          project_id: t.projectId,
          target_kind: 'category',
          target_id: t.categoryId,
          canonical_url: `https://other.example/${state}`,
          product_name: `${state} drill`,
          brand_name: 'Other',
          state,
          source_kind: 'manual',
          evidence: '{}',
          attempt_id: null,
          decision_at: null,
          created_at: new Date(),
        })
        .execute();
    const frozen = await freezeCommerceContext(db, t.scope, [t.promptId]);
    expect(frozen.targets[0]).toMatchObject({
      products: [{ name: 'Small drill', price: 12.5 }],
      approved_competitors: [{ product_name: 'approved drill' }],
    });
    expect(frozen.targets[0]?.approved_competitors).toHaveLength(1);
    await db
      .updateTable('commerce_products')
      .set({ name: 'Edited', lifecycle_state: 'archived' })
      .where('id', '=', t.productId)
      .execute();
    expect(frozen.targets[0]?.products[0]?.name).toBe('Small drill');
    await expect(freezeCommerceContext(db, t.scope, [t.promptId])).rejects.toMatchObject({
      status: 400,
    });
  });
  it('rejects an empty shelf and excludes foreign membership and unapproved prompt targets', async () => {
    const t = await seed(),
      foreign = await seed();
    await db
      .deleteFrom('commerce_product_categories')
      .where('category_id', '=', t.categoryId)
      .execute();
    // A corrupt membership must not import another workspace's product into this snapshot.
    await addMembership(db, t.scope, foreign.productId, t.categoryId, null);
    await expect(freezeCommerceContext(db, t.scope, [t.promptId])).rejects.toMatchObject({
      status: 400,
    });
    await db
      .updateTable('commerce_prompt_targets')
      .set({ approved_at: null })
      .where('id', '=', t.targetId)
      .execute();
    expect(
      (await freezeCommerceContext(db, t.scope, [t.promptId, foreign.promptId])).targets,
    ).toEqual([]);
    await expect(
      freezeCommerceContext(db, { ...t.scope, workspaceId: foreign.workspaceId }, [t.promptId]),
    ).rejects.toMatchObject({ status: 404 });
  });
});
