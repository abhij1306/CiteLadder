import { afterAll, expect, it } from 'vitest';
import { testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';
import { repriceExecutions } from '../src/audits/repricing.ts';
import { costPolicy } from '../src/audits/costs.ts';
import { auditPerformance } from '../src/audits/performance.ts';
import { randomUUID } from 'node:crypto';
const db = testDatabase(),
  fixtures = new VisibilityFixtures(db);
afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});
it('previews scoped persisted artifacts and appends each version pair once', async () => {
  const t = await fixtures.tenant(),
    auditId = await fixtures.audit(t);
  await fixtures.execution(t, { auditId });
  const artifact = await db
    .selectFrom('raw_response_artifacts')
    .select('id')
    .where('audit_id', '=', auditId)
    .executeTakeFirstOrThrow();
  const request = {
    workspaceId: t.workspaceId,
    formulaVersion: costPolicy.formula_version,
    pricingVersion: costPolicy.pricing_version,
    artifactIds: [artifact.id, artifact.id],
    dryRun: true,
  };
  expect(await repriceExecutions(db, request)).toMatchObject({
    candidates: 1,
    alreadyProjected: 0,
    appended: 0,
    wouldAppend: 1,
  });
  const other = await fixtures.tenant();
  expect(await repriceExecutions(db, { ...request, workspaceId: other.workspaceId })).toMatchObject(
    { candidates: 0 },
  );
  const concurrent = await Promise.all(
    [1, 2].map(() => repriceExecutions(db, { ...request, dryRun: false })),
  );
  expect(concurrent.reduce((sum, report) => sum + report.appended, 0)).toBe(1);
  expect(
    await db
      .selectFrom('execution_cost_projections')
      .select('id')
      .where('raw_response_artifact_id', '=', artifact.id)
      .execute(),
  ).toHaveLength(1);
  expect(await repriceExecutions(db, request)).toMatchObject({
    alreadyProjected: 1,
    wouldAppend: 0,
  });
});
it('refuses to label arithmetic with an uncomputed formula or unknown catalogue', async () => {
  const request = {
    formulaVersion: costPolicy.formula_version,
    pricingVersion: costPolicy.pricing_version,
    dryRun: true,
  };
  await expect(repriceExecutions(db, { ...request, formulaVersion: 'uncomputed' })).rejects.toThrow(
    'formula',
  );
  await expect(repriceExecutions(db, { ...request, pricingVersion: 'unknown' })).rejects.toThrow(
    'catalogued',
  );
});
it('uses one latest projection per artifact without fabricating missing usage', async () => {
  const t = await fixtures.tenant(),
    auditId = await fixtures.audit(t);
  const { taskId } = await fixtures.execution(t, { auditId });
  const artifact = await db
    .selectFrom('raw_response_artifacts')
    .select('id')
    .where('task_id', '=', taskId)
    .executeTakeFirstOrThrow();
  for (const [version, timestamp] of [
    ['old', 0],
    ['new', 1],
  ] as const) {
    await db
      .insertInto('execution_cost_projections')
      .values({
        id: randomUUID(),
        audit_id: auditId,
        task_id: taskId,
        raw_response_artifact_id: artifact.id,
        pricing_version: version,
        formula_version: 'fixture',
        projection_status: 'partial',
        output_tokens: 20,
        projected_total_cost_microusd: 50,
        created_at: new Date(Date.now() + timestamp * 1000),
      })
      .execute();
  }
  expect(await auditPerformance(db, t.workspaceId, auditId)).toMatchObject({
    projected_cost_microusd: 50,
    usage: { input_tokens: null, output_tokens: 20, total_tokens: null },
  });
});
