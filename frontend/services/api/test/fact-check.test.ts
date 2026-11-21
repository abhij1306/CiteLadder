import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import { admittedFactCheck } from '../src/perception/admission.ts';
import { answerPerception } from '../src/perception/executor.ts';
import { factVerification } from '../src/perception/fact-verification.ts';
import { ANSWER, factCheckHarness, fakeGateway, perceptionOutput } from './fact-check-support.ts';
import { TEST_SESSION_COOKIE, sessionToken } from './support.ts';
import { frozen } from './visibility-read-support.ts';
import type { Tenant } from './visibility-fixtures.ts';

const { db, app, fixtures, call, confirmedFact, pilotConfiguration, analysed, drain, queued } =
  factCheckHarness();

let tenant: Tenant;

beforeEach(async () => {
  tenant = await fixtures.tenant();
});

afterAll(async () => {
  await fixtures.cleanup();
  await db.destroy();
});

describe('brand facts', () => {
  it('appends a revision on every change and refuses an edit of a stale revision', async () => {
    const created = await call(tenant, 'POST', '/brand-facts', {
      topic: 'pricing',
      statement: 'Pro costs $59 per month.',
    });
    expect(created.body).toMatchObject({ status: 'draft', revision: 1, source_url: null });
    const id = String(created.body.id);
    const confirmed = await call(tenant, 'PATCH', `/brand-facts/${id}`, {
      expected_revision: 1,
      status: 'confirmed',
    });
    expect(confirmed.body).toMatchObject({ status: 'confirmed', revision: 2 });
    const stale = await call(tenant, 'PATCH', `/brand-facts/${id}`, {
      expected_revision: 1,
      statement: 'Pro costs $69 per month.',
    });
    expect(stale.status).toBe(409);
    const retired = await call(tenant, 'PATCH', `/brand-facts/${id}`, {
      expected_revision: 2,
      status: 'retired',
    });
    expect(retired.body).toMatchObject({ status: 'retired', revision: 3 });
    const revived = await call(tenant, 'PATCH', `/brand-facts/${id}`, {
      expected_revision: 3,
      status: 'confirmed',
    });
    expect(revived.status).toBe(409);
    const revisions = await db
      .selectFrom('brand_fact_revisions')
      .select(['revision', 'status', 'statement', 'created_by_user_id'])
      .where('fact_id', '=', id)
      .orderBy('revision')
      .execute();
    expect(revisions).toEqual([
      {
        revision: 1,
        status: 'draft',
        statement: 'Pro costs $59 per month.',
        created_by_user_id: tenant.userId,
      },
      {
        revision: 2,
        status: 'confirmed',
        statement: 'Pro costs $59 per month.',
        created_by_user_id: tenant.userId,
      },
      {
        revision: 3,
        status: 'retired',
        statement: 'Pro costs $59 per month.',
        created_by_user_id: tenant.userId,
      },
    ]);
  });

  it("never reads or edits another workspace's facts", async () => {
    const id = await confirmedFact(tenant, 'pricing', 'Pro costs $59 per month.');
    const other = await fixtures.tenant();
    expect((await call(other, 'GET', '/brand-facts')).body).toMatchObject({
      enabled: true,
      facts: [],
    });
    const forged = await call(other, 'PATCH', `/brand-facts/${id}`, {
      expected_revision: 2,
      status: 'retired',
    });
    expect(forged.status).toBe(404);
  });

  it('freezes only the newest confirmed revisions, and nothing outside the pilot', async () => {
    expect(
      await admittedFactCheck(db, {
        workspaceId: tenant.workspaceId,
        projectId: tenant.projectId,
        auditScope: 'brand',
      }),
    ).toBeNull();
    const confirmed = await confirmedFact(tenant, 'pricing', 'Pro costs $59 per month.');
    await call(tenant, 'PATCH', `/brand-facts/${confirmed}`, {
      expected_revision: 2,
      statement: 'Pro costs $69 per month.',
    });
    await call(tenant, 'POST', '/brand-facts', { topic: 'company', statement: 'Draft only.' });
    const retired = await confirmedFact(tenant, 'markets', 'Sold in the US.');
    await call(tenant, 'PATCH', `/brand-facts/${retired}`, {
      expected_revision: 2,
      status: 'retired',
    });
    const frozen = await admittedFactCheck(db, {
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      auditScope: 'brand',
    });
    const newest = await db
      .selectFrom('brand_fact_revisions')
      .select('id')
      .where('fact_id', '=', confirmed)
      .where('revision', '=', 3)
      .executeTakeFirstOrThrow();
    expect(frozen?.facts).toEqual([{ revision_id: newest.id, topic: 'pricing' }]);
    expect(
      await admittedFactCheck(db, {
        workspaceId: tenant.workspaceId,
        projectId: tenant.projectId,
        auditScope: 'commerce',
      }),
    ).toBeNull();
  });
});

describe('claim extraction and verification', () => {
  it('extracts brand claims in the perception call, verifies them against the frozen facts and reads the accuracy', async () => {
    await confirmedFact(tenant, 'pricing', 'Pro costs $59 per month.');
    await confirmedFact(tenant, 'company', 'Founded in 2019.');
    const auditId = await fixtures.audit(tenant, {
      configuration: await pilotConfiguration(tenant),
    });
    const taskId = await analysed(tenant, auditId);
    const perception = fakeGateway([perceptionOutput]);
    await drain(tenant, 'answer_perception', answerPerception(perception.factory));
    const sent = JSON.parse(String(perception.fetch.mock.calls[0]?.[1]?.body)) as {
      messages: { content: string }[];
    };
    expect(
      sent.messages[0]?.content.endsWith(policy.perception.fact_check.claims_system_addendum),
    ).toBe(true);
    const claims = await db
      .selectFrom('answer_claims')
      .select(['topic', 'quote', 'quote_start', 'quote_end'])
      .where('workspace_id', '=', tenant.workspaceId)
      .orderBy('ordinal')
      .execute();
    expect(claims).toEqual([
      { topic: 'pricing', quote: 'Acme Pro costs $49 per month', quote_start: 0, quote_end: 28 },
      {
        topic: 'integrations',
        quote: 'Acme integrates with Slack',
        quote_start: 30,
        quote_end: 56,
      },
    ]);
    expect((await queued(tenant, 'fact_verification')).map((row) => row.status)).toEqual([
      'queued',
    ]);

    const verify = fakeGateway([
      JSON.stringify({
        verdicts: [{ claim_id: 'c1', verdict: 'contradicted', fact_ids: ['f1'], confidence: 0.9 }],
      }),
    ]);
    await drain(tenant, 'fact_verification', factVerification(verify.factory));
    const verifyRequest = JSON.parse(String(verify.fetch.mock.calls[0]?.[1]?.body)) as {
      messages: { content: string }[];
    };
    expect(verifyRequest.messages[1]?.content).toContain('Pro costs $59 per month.');
    expect(verifyRequest.messages[1]?.content).not.toContain('Slack');

    const summary = await call(tenant, 'GET', `/visibility/accuracy?audit_id=${auditId}`);
    expect(summary.body).toMatchObject({
      state: 'value',
      score: {
        accuracy: 0,
        coverage: { claims: 2, contradicted: 1, not_covered: 1, supported: 0, pending: 0 },
      },
      contradicted: [
        {
          quote: 'Acme Pro costs $49 per month',
          topic: 'pricing',
          verdict: 'contradicted',
          facts: [{ topic: 'pricing', statement: 'Pro costs $59 per month.', source_url: null }],
          run_id: auditId,
          execution_id: taskId,
        },
      ],
    });

    const [fact] = (await call(tenant, 'GET', '/brand-facts')).body.facts as { id: string }[];
    await call(tenant, 'PATCH', `/brand-facts/${fact!.id}`, {
      expected_revision: 2,
      statement: 'Pro costs $49 per month.',
    });
    const token = await sessionToken({ sub: tenant.userId, ver: 0 });
    const execution = (await (
      await app.request(`/api/v1/executions/${taskId}`, {
        headers: {
          cookie: `${TEST_SESSION_COOKIE}=${token}`,
          'x-workspace-id': tenant.workspaceId,
        },
      })
    ).json()) as { claims: { verdict: string | null; facts: { statement: string }[] }[] };
    expect(execution.claims.map((row) => [row.verdict, row.facts.map((f) => f.statement)])).toEqual(
      [
        ['contradicted', ['Pro costs $59 per month.']],
        ['not_covered', []],
      ],
    );

    const observedAt = (summary.body.contradicted as { observed_at: string }[])[0]!.observed_at;
    const byFact = await call(tenant, 'GET', `/visibility/accuracy/facts?audit_id=${auditId}`);
    expect(byFact.body).toMatchObject({
      enabled: true,
      facts: [
        {
          fact_id: fact!.id,
          revision: 2,
          statement: 'Pro costs $59 per month.',
          counts: {
            kind: 'raised',
            claims: 1,
            supported: 0,
            contradicted: 1,
            inconclusive: 0,
            last_raised_at: observedAt,
          },
        },
        { revision: 2, statement: 'Founded in 2019.', counts: { kind: 'not_raised' } },
      ],
    });

    await db
      .updateTable('projects')
      .set({ country_code: 'GB' })
      .where('id', '=', tenant.projectId)
      .execute();
    const csv = await app.request(
      `/api/v1/projects/${tenant.projectId}/visibility/accuracy/claims/export?audit_id=${auditId}`,
      {
        headers: {
          cookie: `${TEST_SESSION_COOKIE}=${token}`,
          'x-workspace-id': tenant.workspaceId,
        },
      },
    );
    expect(csv.headers.get('content-disposition')).toBe(
      'attachment; filename="fact-check-claims.csv"',
    );
    const market = 'United States · English';
    expect(await csv.text()).toBe(
      'claim,facts,verdict,model_verdict,engine,market,run_date,prompt\r\n' +
        `Acme Pro costs $49 a month.,Pro costs $59 per month. (revision 2),contradicted,contradicted,ChatGPT API,${market},${observedAt},best tools?\r\n` +
        `Acme integrates with Slack.,,not_covered,not_covered,ChatGPT API,${market},${observedAt},best tools?\r\n`,
    );

    const attacker = await fixtures.tenant();
    const forged = await call(attacker, 'GET', `/visibility/accuracy/facts?audit_id=${auditId}`);
    expect(forged.status).toBe(404);
    const forgedCsv = await call(
      attacker,
      'GET',
      `/visibility/accuracy/claims/export?audit_id=${auditId}`,
    );
    expect(forgedCsv.status).toBe(404);
  });

  it('verifies a claim the extractor filed under a neighbouring topic instead of calling it not covered', async () => {
    await confirmedFact(tenant, 'specs', 'The Pro plan includes 50 projects.');
    const auditId = await fixtures.audit(tenant, {
      configuration: await pilotConfiguration(tenant),
    });
    await analysed(tenant, auditId, 'Acme Pro includes unlimited projects. Rival support is slow.');
    const extraction = JSON.stringify({
      entities: [{ entity_id: 'brand:acme', label: 'neutral', confidence: 0.9, aspects: [] }],
      claims: [
        {
          topic: 'plans',
          claim: 'Acme Pro includes unlimited projects.',
          quote: 'Acme Pro includes unlimited projects',
          confidence: 0.9,
        },
      ],
    });
    await drain(tenant, 'answer_perception', answerPerception(fakeGateway([extraction]).factory));
    const verify = fakeGateway([
      JSON.stringify({
        verdicts: [{ claim_id: 'c1', verdict: 'contradicted', fact_ids: ['f1'], confidence: 0.9 }],
      }),
    ]);
    await drain(tenant, 'fact_verification', factVerification(verify.factory));
    const request = JSON.parse(String(verify.fetch.mock.calls[0]?.[1]?.body)) as {
      messages: { content: string }[];
    };
    expect(request.messages[1]?.content).toContain('The Pro plan includes 50 projects.');
    const summary = await call(tenant, 'GET', `/visibility/accuracy?audit_id=${auditId}`);
    expect(summary.body).toMatchObject({
      score: { coverage: { claims: 1, contradicted: 1, not_covered: 0 } },
      contradicted: [
        { topic: 'plans', facts: [{ statement: 'The Pro plan includes 50 projects.' }] },
      ],
    });
  });

  it('extracts no claims for an audit admitted without confirmed facts', async () => {
    const configuration = await pilotConfiguration(tenant);
    expect(configuration.fact_check).toBeNull();
    const auditId = await fixtures.audit(tenant, { configuration });
    await analysed(tenant, auditId);
    const perception = fakeGateway([perceptionOutput]);
    await drain(tenant, 'answer_perception', answerPerception(perception.factory));
    const sent = JSON.parse(String(perception.fetch.mock.calls[0]?.[1]?.body)) as {
      messages: { content: string }[];
    };
    expect(sent.messages[0]?.content).toBe(policy.perception.system_template);
    const claims = await db
      .selectFrom('answer_claims')
      .select('id')
      .where('workspace_id', '=', tenant.workspaceId)
      .execute();
    expect([claims.length, (await queued(tenant, 'fact_verification')).length]).toEqual([0, 0]);
    const accuracy = await call(tenant, 'GET', `/visibility/accuracy?audit_id=${auditId}`);
    expect(accuracy.body.state).toBe('no_facts');
  });

  it('ends over the cap or without a gateway as an explained unavailable outcome', async () => {
    await confirmedFact(tenant, 'pricing', 'Pro costs $59 per month.');
    const auditId = await fixtures.audit(tenant, {
      configuration: await pilotConfiguration(tenant),
    });
    await analysed(tenant, auditId);
    await analysed(tenant, auditId, `${ANSWER} Again.`);
    await drain(
      tenant,
      'answer_perception',
      answerPerception(fakeGateway([perceptionOutput, perceptionOutput]).factory),
    );
    const verify = fakeGateway([
      JSON.stringify({
        verdicts: [{ claim_id: 'c1', verdict: 'supported', fact_ids: ['f1'], confidence: 0.9 }],
      }),
    ]);
    await drain(
      tenant,
      'fact_verification',
      factVerification(verify.factory, {
        ...policy.perception.fact_check,
        max_verifications_per_audit: 1,
      }),
    );
    const outcomes = await db
      .selectFrom('fact_verifications')
      .select(['outcome', 'outcome_reason'])
      .where('workspace_id', '=', tenant.workspaceId)
      .execute();
    expect(outcomes.map((row) => row.outcome_reason ?? row.outcome).toSorted()).toEqual([
      'platform_cap',
      'verified',
    ]);
    expect(verify.fetch).toHaveBeenCalledTimes(1);
    const summary = await call(tenant, 'GET', `/visibility/accuracy?audit_id=${auditId}`);
    expect(summary.body).toMatchObject({
      state: 'value',
      score: { coverage: { supported: 1, unavailable: [{ reason: 'platform_cap', count: 1 }] } },
    });

    const second = await fixtures.tenant();
    await confirmedFact(second, 'pricing', 'Pro costs $59 per month.');
    const secondAudit = await fixtures.audit(second, {
      configuration: await pilotConfiguration(second),
    });
    await analysed(second, secondAudit);
    await drain(
      second,
      'answer_perception',
      answerPerception(fakeGateway([perceptionOutput]).factory),
    );
    await drain(
      second,
      'fact_verification',
      factVerification(() => null),
    );
    const unconfigured = await call(second, 'GET', `/visibility/accuracy?audit_id=${secondAudit}`);
    expect(unconfigured.body).toMatchObject({
      state: 'value',
      score: {
        accuracy: null,
        coverage: { not_covered: 1, unavailable: [{ reason: 'model_not_configured', count: 1 }] },
      },
    });
  });

  it('never verifies claims with a model other than the one the audit froze', async () => {
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
    const verify = fakeGateway([], 'redeployed-model');
    await drain(tenant, 'fact_verification', factVerification(verify.factory));

    const read = await call(tenant, 'GET', `/visibility/accuracy?audit_id=${auditId}`);
    expect(read.body).toMatchObject({
      state: 'value',
      score: {
        accuracy: null,
        coverage: { not_covered: 1, unavailable: [{ reason: 'model_changed', count: 1 }] },
      },
    });
    expect(verify.fetch).not.toHaveBeenCalled();
  });

  it('never reads or writes another workspace through a forged payload', async () => {
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
    const [victim] = await queued(tenant, 'fact_verification');
    const attacker = await fixtures.tenant();
    await db
      .insertInto('analytics_tasks')
      .values({
        id: randomUUID(),
        workspace_id: attacker.workspaceId,
        project_id: attacker.projectId,
        task_kind: 'fact_verification',
        payload: JSON.stringify(victim!.payload),
        idempotency_key: `forged:${randomUUID()}`,
        status: 'queued',
        priority: 0,
        randomized_position: 0,
        available_at: new Date(),
        attempt_count: 0,
        max_attempts: 1,
        error_code: '',
        error_detail: '',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
    const gateway = fakeGateway([]);
    await drain(attacker, 'fact_verification', factVerification(gateway.factory));
    expect(gateway.fetch).not.toHaveBeenCalled();
    expect((await queued(attacker, 'fact_verification')).map((row) => row.status)).toEqual([
      'failed',
    ]);
    const written = await db
      .selectFrom('fact_verifications')
      .select('id')
      .where('workspace_id', '=', tenant.workspaceId)
      .execute();
    expect(written).toEqual([]);
  });
});

describe('accuracy reads', () => {
  it("trends a pooled period's claims over every run in its window, breaking where runs aren't comparable", async () => {
    await confirmedFact(tenant, 'pricing', 'Pro costs $59 per month.');
    const configuration = await pilotConfiguration(tenant);
    const run = async (at: string, panel: string) => {
      const auditId = await fixtures.audit(tenant, {
        completedAt: new Date(at),
        configuration: { ...frozen({ panel_hash: panel }), ...configuration },
      });
      await fixtures.metricSnapshot(tenant, auditId, { metrics: { total_completed: 1 } });
      await analysed(tenant, auditId);
      return auditId;
    };
    await run('2026-03-20T00:00:00Z', 'panel-1');
    const pooled = await run('2026-04-02T00:00:00Z', 'panel-1');
    const other = await run('2026-04-05T00:00:00Z', 'panel-2');

    const window = 'from=2026-04-01T00:00:00Z&to=2026-04-08T00:00:00Z';
    const { status, body } = await call(
      tenant,
      'GET',
      `/visibility/accuracy?audit_ids=${pooled}&${window}`,
    );

    expect(status).toBe(200);
    expect(body.source_audit_ids).toEqual([pooled]);
    expect(
      (body.trend as { audit_id: string; comparable: boolean }[]).map((point) => [
        point.audit_id,
        point.comparable,
      ]),
    ).toEqual([
      [pooled, true],
      [other, false],
    ]);
  });
});
