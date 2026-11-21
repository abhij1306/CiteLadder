import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { admittedFactCheck } from '../src/perception/admission.ts';
import { answerPerception } from '../src/perception/executor.ts';
import { factVerification } from '../src/perception/fact-verification.ts';
import { factCheckHarness, fakeGateway, perceptionOutput } from './fact-check-support.ts';
import type { Tenant } from './visibility-fixtures.ts';

const { db, fixtures, enroll, call, confirmedFact, pilotConfiguration, analysed, drain } =
  factCheckHarness();

let tenant: Tenant;

beforeEach(async () => {
  tenant = await fixtures.tenant();
});

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

async function checkedAudit(verdict: string, confidence: number) {
  await enroll(tenant);
  await confirmedFact(tenant, 'pricing', 'Pro costs $59 per month.');
  const auditId = await fixtures.audit(tenant, {
    configuration: await pilotConfiguration(tenant),
  });
  await analysed(tenant, auditId);
  await drain(
    tenant,
    'answer_perception',
    answerPerception(fakeGateway([perceptionOutput]).factory),
  );
  const verdicts = [{ claim_id: 'c1', verdict, fact_ids: ['f1'], confidence }];
  await drain(
    tenant,
    'fact_verification',
    factVerification(fakeGateway([JSON.stringify({ verdicts })]).factory),
  );
  return auditId;
}

type Item = {
  topic: string;
  status: string;
  verdict: string | null;
  verdict_id: string | null;
  edited: unknown;
};

const claimsOf = async (auditId: string) =>
  (await call(tenant, 'GET', `/visibility/accuracy/claims?audit_id=${auditId}`)).body
    .items as Item[];

describe('verdict overrides', () => {
  it('counts the newest verdict override, keeps the model verdict and refuses other workspaces', async () => {
    const auditId = await checkedAudit('contradicted', 0.9);
    const before = await claimsOf(auditId);
    expect(before.map((item) => [item.topic, item.verdict_id === null, item.edited])).toEqual([
      ['pricing', false, null],
      ['integrations', true, null],
    ]);
    const verdictId = before[0]!.verdict_id!;
    const path = `/claim-verdicts/${verdictId}/overrides`;
    const override = (owner: Tenant, verdict: string, note?: string) =>
      call(owner, 'POST', path, { verdict, note });

    const outside = await fixtures.tenant();
    const refused = await override(outside, 'supported');
    expect([refused.status, (refused.body.error as { code: string }).code]).toEqual([
      409,
      'fact_checking_not_in_plan',
    ]);
    const attacker = await fixtures.tenant();
    await enroll(attacker);
    expect((await override(attacker, 'supported')).status).toBe(404);
    expect((await override(tenant, 'contradicted')).status).toBe(409);

    const first = await override(tenant, 'inconclusive', ' Checked the pricing page ');
    expect(first.body).toMatchObject({
      verdict_id: verdictId,
      model_verdict: 'contradicted',
      verdict: 'inconclusive',
      note: 'Checked the pricing page',
    });
    expect((await override(tenant, 'supported')).status).toBe(200);
    const summary = await call(tenant, 'GET', `/visibility/accuracy?audit_id=${auditId}`);
    expect(summary.body).toMatchObject({
      score: {
        accuracy: 1,
        coverage: { supported: 1, contradicted: 0, inconclusive: 0, not_covered: 1, edited: 1 },
      },
      contradicted: [],
    });
    expect((await claimsOf(auditId))[0]).toMatchObject({
      verdict: 'supported',
      edited: { model_verdict: 'contradicted', note: null },
    });

    const model = await db
      .selectFrom('claim_verdicts')
      .select('verdict')
      .where('id', '=', verdictId)
      .executeTakeFirstOrThrow();
    expect(model.verdict).toBe('contradicted');
    const history = await db
      .selectFrom('claim_verdict_overrides')
      .select(['from_verdict', 'to_verdict', 'created_by_user_id'])
      .where('workspace_id', '=', tenant.workspaceId)
      .orderBy('created_at')
      .execute();
    expect(history).toEqual([
      {
        from_verdict: 'contradicted',
        to_verdict: 'inconclusive',
        created_by_user_id: tenant.userId,
      },
      { from_verdict: 'contradicted', to_verdict: 'supported', created_by_user_id: tenant.userId },
    ]);

    expect((await override(tenant, 'contradicted')).status).toBe(200);
    const reverted = await call(tenant, 'GET', `/visibility/accuracy?audit_id=${auditId}`);
    expect(reverted.body).toMatchObject({
      score: { accuracy: 0, coverage: { contradicted: 1, edited: 0 } },
    });
  });

  it('counts any verdict a person gives a low-confidence claim as edited', async () => {
    const auditId = await checkedAudit('supported', 0.3);
    const [before] = await claimsOf(auditId);
    expect([before!.status, before!.verdict]).toEqual(['low_confidence', null]);

    const settled = await call(tenant, 'POST', `/claim-verdicts/${before!.verdict_id}/overrides`, {
      verdict: 'inconclusive',
    });
    expect(settled.status).toBe(200);
    expect((await claimsOf(auditId))[0]).toMatchObject({
      status: 'verdict',
      verdict: 'inconclusive',
      edited: { model_verdict: 'inconclusive' },
    });
    const summary = await call(tenant, 'GET', `/visibility/accuracy?audit_id=${auditId}`);
    expect(summary.body).toMatchObject({
      score: { coverage: { inconclusive: 1, low_confidence: 0, edited: 1 } },
    });
  });
});

describe('facts CSV import', () => {
  it('imports CSV rows as drafts only, answering each row and skipping duplicates', async () => {
    const outside = await call(tenant, 'POST', '/brand-facts/import', {
      rows: [{ topic: 'pricing', statement: 'x', source_url: null }],
    });
    expect([outside.status, (outside.body.error as { code: string }).code]).toEqual([
      409,
      'fact_checking_not_in_plan',
    ]);
    await enroll(tenant);
    await confirmedFact(tenant, 'pricing', 'Pro costs $59 per month.');
    const imported = await call(tenant, 'POST', '/brand-facts/import', {
      rows: [
        { topic: 'Pricing', statement: 'Pro  costs $59 PER month.', source_url: null },
        { topic: 'plans', statement: 'Starter includes 5 users.', source_url: '' },
        { topic: 'weather', statement: 'Sunny.', source_url: null },
        { topic: 'plans', statement: 'starter includes 5 users.', source_url: null },
        { topic: 'company', statement: 'Founded in 2019.', source_url: 'ftp://acme.test' },
      ],
    });
    expect(imported.status).toBe(200);
    const rows = imported.body.rows as { index: number; kind: string; fact_id?: string }[];
    expect(rows.map(({ index, kind }) => [index, kind])).toEqual([
      [0, 'duplicate'],
      [1, 'created'],
      [2, 'invalid'],
      [3, 'duplicate'],
      [4, 'invalid'],
    ]);
    const facts = (await call(tenant, 'GET', '/brand-facts')).body.facts as {
      id: string;
      statement: string;
      status: string;
    }[];
    expect(facts.map(({ statement, status }) => [statement, status])).toEqual([
      ['Pro costs $59 per month.', 'confirmed'],
      ['Starter includes 5 users.', 'draft'],
    ]);
    expect(facts[1]!.id).toBe(rows[1]!.fact_id);
    const revisions = await db
      .selectFrom('brand_fact_revisions')
      .select(['status', 'created_by_user_id'])
      .where('fact_id', '=', rows[1]!.fact_id!)
      .execute();
    expect(revisions).toEqual([{ status: 'draft', created_by_user_id: tenant.userId }]);
    const frozen = await admittedFactCheck(db, {
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      auditScope: 'brand',
    });
    expect(frozen?.facts.map((fact) => fact.topic)).toEqual(['pricing']);
  });
});
