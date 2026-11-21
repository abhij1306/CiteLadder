import { sql } from 'kysely';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { readAgentContext } from '../src/agent/context-adapter.ts';
import { auditRuntime } from '../src/audits/config.ts';
import { createAudits } from '../src/audits/creation.ts';
import { auditInput } from '../src/audits/inputs.ts';
import { settlePromptRun } from '../src/audits/prompt-runs.ts';
import { createRepairAudit } from '../src/audits/repair.ts';
import { transitionAudit } from '../src/audits/state.ts';
import { policy } from '../src/config.ts';
import { loadWorkerSettings } from '../src/config/analytics.ts';
import { createModelGateway, gatewaySettings } from '../src/models/gateway.ts';
import { probeLabelling } from '../src/probes/labelling.ts';
import { enqueueProbeLabelling } from '../src/probes/launch-end.ts';
import { probeMarket } from '../src/probes/market.ts';
import { mergeGroups, renameGroup } from '../src/probes/objection-groups.ts';
import { probeObjections } from '../src/probes/objections.ts';
import { runProbe } from '../src/probes/plan.ts';
import { setProbeSchedule } from '../src/probes/schedule.ts';
import { probeStatus } from '../src/probes/status.ts';
import { addMarket } from '../src/projects/markets.ts';
import { createTheme, deleteTheme } from '../src/projects/themes.ts';
import { AnalyticsWorker } from '../src/workers/analytics-worker.ts';
import { auditTenant, managedPlan } from './audit-fixtures.ts';
import { billingAccount, grant } from './prompt-fixtures.ts';
import { asOwner, testDatabase } from './support.ts';
import { VisibilityFixtures } from './visibility-fixtures.ts';

const db = testDatabase();
const fixtures = new VisibilityFixtures(db);
const runtime = auditRuntime({});
const settings = loadWorkerSettings({});
const LABEL = policy.probes.label_credits;
afterEach(() => fixtures.cleanup());
afterAll(() => db.destroy());

type Tenant = Awaited<ReturnType<typeof auditTenant>>;

async function probeTenant(credits = 1000) {
  const t = await auditTenant(db, fixtures);
  await grant(db, await billingAccount(db, t.workspaceId), { key: 'ai_credits', value: credits });
  const theme = await createTheme(db, t, { name: 'Comfort' });
  const rivalId = await fixtures.competitor(t.projectId, { name: 'Rival Shoes' });
  return { t, themeId: theme.id, rivalId };
}

function launch(t: Tenant) {
  return createAudits(
    db,
    t.workspaceId,
    auditInput.parse({
      project_id: t.projectId,
      prompt_set_id: t.setId,
      engines: ['chatgpt', 'google_ai_overview'],
      audit_scope: 'probe',
      random_seed: '7',
    }),
    {},
    runtime,
  );
}

const ledger = (workspaceId: string) =>
  db
    .selectFrom('consumable_ledger')
    .select(['capability_key', 'entry_kind', 'units'])
    .where('workspace_id', '=', workspaceId)
    .where('subject_kind', '=', 'audit')
    .orderBy('capability_key')
    .orderBy('entry_kind')
    .execute();

describe('probe admission', () => {
  it("freezes the brand and theme questions, three asks each on probe engines, holding only labelling credits on the customer's key", async () => {
    const { t, themeId } = await probeTenant();
    const [auditId] = await launch(t);
    const snapshots = await db
      .selectFrom('audit_prompt_snapshots')
      .select(['prompt_id', 'text', 'cohort', 'generation_evidence'])
      .where('audit_id', '=', auditId)
      .orderBy('prompt_index')
      .execute();
    expect(snapshots.map((row) => [row.prompt_id, row.text, row.cohort])).toEqual([
      [null, 'What is Acme Running known for?', 'probe'],
      [null, 'Why might someone not choose Acme Running?', 'probe'],
      [
        null,
        expect.stringMatching(/^Which .+ brands in United States are best known for comfort\?$/u),
        'probe',
      ],
    ]);
    expect(snapshots[2]!.generation_evidence).toEqual({
      probe: { question: 'theme', theme_id: themeId, theme_name: 'Comfort' },
    });
    const tasks = await db
      .selectFrom('audit_tasks')
      .select(['logical_engine'])
      .where('audit_id', '=', auditId)
      .execute();
    expect(tasks).toHaveLength(9);
    expect(new Set(tasks.map((task) => task.logical_engine))).toEqual(new Set(['chatgpt']));
    const holds = await ledger(t.workspaceId);
    expect(holds.every((row) => row.capability_key === 'ai_credits')).toBe(true);
    expect(holds.reduce((sum, row) => sum + Number(row.units), 0)).toBe(9 * LABEL);
  });

  it('refuses a probe its AI credits cannot cover with ai_credits_exhausted, queuing nothing', async () => {
    const { t } = await probeTenant(9 * LABEL - 1);
    await expect(launch(t)).rejects.toMatchObject({ status: 403, code: 'ai_credits_exhausted' });
    const audits = await db
      .selectFrom('audits')
      .select('id')
      .where('workspace_id', '=', t.workspaceId)
      .execute();
    expect(audits).toEqual([]);
  });

  it("spends a recorded answer's whole hold and releases a failed one's", async () => {
    const { t } = await probeTenant();
    const [auditId] = await launch(t);
    const [ok, failed] = await db
      .selectFrom('audit_tasks')
      .selectAll()
      .where('audit_id', '=', auditId)
      .orderBy('randomized_position')
      .limit(2)
      .execute();
    await db.transaction().execute(async (trx) => {
      await settlePromptRun(trx, ok!, true, new Date());
      await settlePromptRun(trx, failed!, false, new Date());
    });
    const debits = (await ledger(t.workspaceId)).filter((row) => row.entry_kind === 'debit');
    expect(debits.map((row) => Number(row.units))).toEqual([LABEL]);
  });

  it('quotes only the engine-market pairs that run, then launches every market holding exactly the quote', async () => {
    const { t } = await probeTenant(1_000_000);
    await grant(db, await billingAccount(db, t.workspaceId), { key: 'market_slots', value: 1 });
    await addMarket(db, t, { country_code: 'BR', language_code: 'pt', label: '' });
    const perMarket = 3 * policy.probes.repetitions;
    const { quote } = await probeStatus(db, t, runtime);
    expect([quote.markets.length, quote.answers]).toEqual([2, 2 * perMarket]);
    const ids = await runProbe(db, t, { fingerprint: quote.fingerprint }, runtime);
    const held = (await ledger(t.workspaceId)).filter((row) => row.entry_kind === 'reservation');
    expect([ids.length, held.reduce((sum, row) => sum + Number(row.units), 0)]).toEqual([
      2,
      quote.credits,
    ]);
    expect((await probeStatus(db, t, runtime)).quote.balance).toBe(quote.balance! - quote.credits);
    // Managed, Brazil skips Gemini (no location control) and the Gemini app (no Portuguese).
    await managedPlan(db, t.workspaceId);
    const managed = (await probeStatus(db, t, runtime)).quote;
    expect(managed.answers).toBe((5 + 3) * perMarket);
  });

  it('refuses probe_quote_changed, launching nothing, when the probe changed after its quote', async () => {
    const { t } = await probeTenant();
    const { quote } = await probeStatus(db, t, runtime);
    await createTheme(db, t, { name: 'Price' });
    await expect(
      runProbe(db, t, { fingerprint: quote.fingerprint }, runtime),
    ).rejects.toMatchObject({ status: 409, code: 'probe_quote_changed' });
    const audits = await db
      .selectFrom('audits')
      .select('id')
      .where('workspace_id', '=', t.workspaceId)
      .execute();
    expect(audits).toEqual([]);
  });

  it('blocks Run probe past the task limit in a market, and in a trial, refusing the launch', async () => {
    const { t } = await probeTenant();
    const limited = auditRuntime({ AUDIT_MAX_TASKS_PER_AUDIT: '9' });
    const quote = async () => (await probeStatus(db, t, limited)).quote;
    expect((await quote()).blocked).toBeNull();
    await createTheme(db, t, { name: 'Price' });
    const over = await quote();
    expect(over.blocked).toBe('task_limit');
    await expect(runProbe(db, t, { fingerprint: over.fingerprint }, limited)).rejects.toMatchObject(
      { status: 422 },
    );
    const account = await billingAccount(db, t.workspaceId);
    await asOwner((owner) =>
      owner
        .updateTable('account_grants')
        .set({ profile_key: policy.entitlements.public_trial.profile })
        .where('billing_account_id', '=', account)
        .where('key', '=', 'workspace_access')
        .execute(),
    );
    const trial = (await probeStatus(db, t, runtime)).quote;
    expect(trial.blocked).toBe('trial');
    await expect(
      runProbe(db, t, { fingerprint: trial.fingerprint }, runtime),
    ).rejects.toMatchObject({ status: 403, code: 'capability_not_granted' });
    const audits = await db
      .selectFrom('audits')
      .select('id')
      .where('workspace_id', '=', t.workspaceId)
      .execute();
    expect(audits).toEqual([]);
  });

  it('keeps one probe schedule per project on every managed probe engine, and Off removes it', async () => {
    const { t } = await probeTenant();
    const other = await probeTenant();
    await managedPlan(db, t.workspaceId);
    const schedules = (scope: { workspaceId: string; projectId: string }) =>
      db
        .selectFrom('audit_schedules')
        .select(['id', 'audit_scope', 'cadence', 'enabled', 'engines'])
        .where('workspace_id', '=', scope.workspaceId)
        .where('project_id', '=', scope.projectId)
        .execute();
    const fingerprint = async (scope: Tenant) =>
      (await probeStatus(db, scope, runtime)).quote.fingerprint;
    await expect(
      setProbeSchedule(db, t, { cadence: 'weekly', fingerprint: 'stale' }, runtime),
    ).rejects.toMatchObject({ status: 409, code: 'probe_quote_changed' });
    await db.transaction().execute(async (launching) => {
      await launching
        .selectFrom('projects')
        .select('id')
        .where('id', '=', t.projectId)
        .forKeyShare()
        .execute();
      const shown = await fingerprint(t);
      await db.transaction().execute(async (trx) => {
        await sql`set local lock_timeout = '5s'`.execute(trx);
        await setProbeSchedule(trx, t, { cadence: 'weekly', fingerprint: shown }, runtime);
      });
    });
    await setProbeSchedule(
      db,
      other.t,
      { cadence: 'daily', fingerprint: await fingerprint(other.t) },
      runtime,
    );
    const [weekly] = await schedules(t);
    await setProbeSchedule(db, t, { cadence: 'daily', fingerprint: await fingerprint(t) }, runtime);
    expect(await schedules(t)).toEqual([
      {
        id: weekly?.id,
        audit_scope: 'probe',
        cadence: 'daily',
        enabled: true,
        engines: policy.probes.engines,
      },
    ]);
    await setProbeSchedule(db, t, { cadence: null }, runtime);
    expect(await schedules(t)).toEqual([]);
    expect((await schedules(other.t)).map((row) => row.cadence)).toEqual(['daily']);
  });
});

async function answered(t: Tenant, auditId: string) {
  await db
    .updateTable('audit_tasks')
    .set({ status: 'succeeded', answer_text: 'An answer.', completed_at: new Date() })
    .where('workspace_id', '=', t.workspaceId)
    .where('audit_id', '=', auditId)
    .execute();
  await db
    .updateTable('audits')
    .set({ completed_count: 9, completed_at: new Date() })
    .where('workspace_id', '=', t.workspaceId)
    .where('id', '=', auditId)
    .execute();
  await ended(t, auditId, 'completed');
}

async function ended(t: Tenant, auditId: string, status: 'completed' | 'cancelled') {
  const steps = status === 'completed' ? ['running', 'analyzing', 'reporting', status] : [status];
  await db.transaction().execute(async (trx) => {
    for (const step of steps) await transitionAudit(trx, t.workspaceId, auditId, step, new Date());
  });
}

const launchOf = async (auditId: string) =>
  (
    await db
      .selectFrom('audits')
      .select('launch_id')
      .where('id', '=', auditId)
      .executeTakeFirstOrThrow()
  ).launch_id!;

function labeller(
  outputs: { known: unknown; objection: unknown; theme: unknown },
  onCall: (sent: string) => Promise<void> = async () => {},
) {
  const fetch = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const sent = String(init?.body ?? '');
    await onCall(sent);
    let content = outputs.theme;
    if (sent.includes('known for?')) content = outputs.known;
    else if (sent.includes('not choose')) content = outputs.objection;
    return Response.json({
      model: 'returned-model',
      choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
  });
  const gateway = createModelGateway(
    {
      ...gatewaySettings({}),
      apiKey: 'test-only',
      model: 'test',
      baseUrl: 'https://model.test/v1',
    },
    { fetch, sleep: async () => {} },
  );
  return () => gateway;
}

async function label(t: Tenant, factory: () => ReturnType<ReturnType<typeof labeller>>) {
  const ids = (
    await db
      .selectFrom('analytics_tasks')
      .select('id')
      .where('workspace_id', '=', t.workspaceId)
      .where('task_kind', '=', policy.probes.task_kind)
      .execute()
  ).map((row) => row.id);
  const worker = new AnalyticsWorker(db, settings, {
    executors: { probe_labelling: probeLabelling(factory) },
    taskScope: { workspaceId: t.workspaceId, taskIds: ids },
  });
  await worker.runUntilIdle();
}

const first = {
  known: {
    answers: [
      {
        answer: 1,
        points: [
          { theme: 'comfort', quote: '' },
          { theme: 'Funding', quote: '' },
        ],
      },
      { answer: 2, points: [{ theme: 'Comfort', quote: '' }] },
      { answer: 3, points: [] },
    ],
  },
  objection: {
    answers: [
      {
        answer: 1,
        reasons: [
          { group: 'Too expensive', quote: '' },
          { group: 'Fit runs small', quote: '' },
        ],
      },
      { answer: 2, reasons: [{ group: 'too expensive', quote: '' }] },
      {
        answer: 3,
        reasons: [
          { group: 'Fit runs small', quote: '' },
          { group: 'Too Expensive', quote: '' },
        ],
      },
    ],
  },
  theme: {
    answers: [
      { answer: 1, brands: ['Acme Running', 'Rival Shoes'] },
      { answer: 2, brands: ['Rival Shoes', 'Big Co', 'Acme Running'] },
      { answer: 3, brands: ['Rival Shoes'] },
    ],
  },
};

describe('probe labelling and reads', () => {
  it('still labels a probe whose theme was deleted after admission, dropping that theme', async () => {
    const { t, themeId } = await probeTenant();
    const [auditId] = await launch(t);
    await answered(t, auditId);
    await deleteTheme(db, { ...t, themeId });
    await label(t, labeller(first));
    const labelling = await db
      .selectFrom('probe_labellings')
      .select('outcome')
      .where('launch_id', '=', await launchOf(auditId))
      .executeTakeFirstOrThrow();
    const market = await probeMarket(db, t);
    expect([labelling.outcome, market.state === 'value' ? market.themes : null]).toEqual([
      'labelled',
      [],
    ]);
  });

  it('labels a probe once, scores Market and Objections, then maps the next probe onto the same groups', async () => {
    const { t, themeId, rivalId } = await probeTenant();
    const [firstId] = await launch(t);
    await answered(t, firstId);
    await label(t, labeller(first));
    const market = await probeMarket(db, t);
    if (market.state !== 'value') throw new Error('expected a labelled probe');
    expect(market.known_for.map(({ theme, score }) => [theme, score])).toEqual([
      ['Comfort', 67],
      ['Other', 30],
    ]);
    expect(market.themes).toEqual([
      {
        theme_id: themeId,
        theme: 'Comfort',
        entities: [
          { kind: 'brand', id: null, name: 'Acme Running', score: 60, named: true },
          { kind: 'competitor', id: rivalId, name: 'Rival Shoes', score: 97, named: true },
        ],
        rank: 2,
        of: 2,
        leader: { kind: 'competitor', id: rivalId, name: 'Rival Shoes', score: 97, named: true },
        gap: 37,
      },
    ]);
    expect([market.known_for_answers, market.language_code]).toEqual([3, 'en']);
    expect(market.engines).toEqual([
      {
        engine: 'chatgpt',
        answered: true,
        top_themes: [
          { theme_id: themeId, theme: 'Comfort' },
          { theme_id: null, theme: 'Other' },
        ],
        rank_in_top_theme: { kind: 'rank', rank: 2 },
      },
    ]);

    const [secondId] = await launch(t);
    await answered(t, secondId);
    await label(
      t,
      labeller({
        ...first,
        objection: {
          answers: [1, 2, 3].map((answer) => ({
            answer,
            reasons: [
              { group: 'TOO EXPENSIVE', quote: '' },
              { group: 'Slow delivery', quote: '' },
            ],
          })),
        },
      }),
    );
    await enqueueProbeLabelling(db, {
      workspaceId: t.workspaceId,
      projectId: t.projectId,
      launchId: await launchOf(secondId),
    });
    const objections = await probeObjections(db, t);
    if (objections.state !== 'value') throw new Error('expected a labelled probe');
    expect(
      objections.groups.map(({ name, score, engines, history, sources }) => [
        name,
        score,
        engines,
        history,
        sources,
      ]),
    ).toEqual([
      ['Too expensive', 100, ['chatgpt'], [97, 100], 0],
      ['Slow delivery', 90, ['chatgpt'], [0, 90], 0],
      ['Fit runs small', 0, [], [63, 0], null],
    ]);
    expect([objections.average, objections.answered_by]).toEqual([95, ['chatgpt']]);
    const labellings = await db
      .selectFrom('probe_labellings')
      .select('outcome')
      .where('workspace_id', '=', t.workspaceId)
      .execute();
    expect(labellings).toEqual([{ outcome: 'labelled' }, { outcome: 'labelled' }]);
  });

  it('merges and renames groups inside their project only', async () => {
    const owner = await probeTenant();
    const other = await probeTenant();
    const [auditId] = await launch(owner.t);
    await answered(owner.t, auditId);
    await label(owner.t, labeller(first));
    const groups = await db
      .selectFrom('probe_objection_groups')
      .select(['id', 'name'])
      .where('project_id', '=', owner.t.projectId)
      .orderBy('name')
      .execute();
    const [fit, price] = groups;
    expect(
      await probeObjections(db, { workspaceId: other.t.workspaceId, projectId: owner.t.projectId }),
    ).toEqual({
      state: 'none',
    });
    await expect(
      renameGroup(
        db,
        { workspaceId: other.t.workspaceId, projectId: owner.t.projectId, groupId: fit!.id },
        { name: 'Taken' },
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      mergeGroups(db, { ...other.t, groupId: fit!.id, intoId: price!.id }),
    ).rejects.toMatchObject({ status: 404 });
    await mergeGroups(db, { ...owner.t, groupId: fit!.id, intoId: price!.id });
    const objections = await probeObjections(db, owner.t);
    if (objections.state !== 'value') throw new Error('expected a labelled probe');
    expect(objections.groups.map(({ name, score }) => [name, score])).toEqual([
      ['Too expensive', 100],
    ]);
  });

  it('labels a launch once, after its last market ends, reading only the markets that answered', async () => {
    const { t } = await probeTenant(1_000_000);
    await grant(db, await billingAccount(db, t.workspaceId), { key: 'market_slots', value: 1 });
    await addMarket(db, t, { country_code: 'BR', language_code: 'pt', label: '' });
    const { quote } = await probeStatus(db, t, runtime);
    const [usId, brId] = await runProbe(db, t, { fingerprint: quote.fingerprint }, runtime);
    const queued = () =>
      db
        .selectFrom('analytics_tasks')
        .select('payload')
        .where('workspace_id', '=', t.workspaceId)
        .where('task_kind', '=', policy.probes.task_kind)
        .execute();
    await answered(t, usId!);
    expect(await queued()).toEqual([]);
    await ended(t, brId!, 'cancelled');
    expect(await queued()).toEqual([{ payload: { launch_id: await launchOf(usId!) } }]);
    const sent: string[] = [];
    await label(
      t,
      labeller(first, async (body) => {
        sent.push(body);
      }),
    );
    expect(sent.filter((body) => body.includes('not choose'))).toHaveLength(1);
    const market = await probeMarket(db, t);
    if (market.state !== 'value') throw new Error('expected a labelled probe');
    expect(market.probe.markets.map((row) => row.country_code)).toEqual(['US']);
  });

  it('labels each market in its own calls, a later market seeing the groups an earlier one named', async () => {
    const { t } = await probeTenant(1_000_000);
    await grant(db, await billingAccount(db, t.workspaceId), { key: 'market_slots', value: 1 });
    await addMarket(db, t, { country_code: 'BR', language_code: 'pt', label: '' });
    const { quote } = await probeStatus(db, t, runtime);
    const [usId, brId] = await runProbe(db, t, { fingerprint: quote.fingerprint }, runtime);
    await answered(t, usId!);
    await answered(t, brId!);
    const sent: string[] = [];
    await label(
      t,
      labeller(first, async (body) => {
        sent.push(body);
      }),
    );
    const objections = sent.filter((body) => body.includes('not choose'));
    expect(objections.map((body) => body.includes('(none yet)'))).toEqual([true, false]);
    const market = await probeMarket(db, t);
    if (market.state !== 'value') throw new Error('expected a labelled probe');
    expect(new Set(market.probe.markets.map((row) => row.country_code))).toEqual(
      new Set(['BR', 'US']),
    );
    expect(market.language_code).toBe('');
  });

  it('keeps a probe labelled when a theme and a group are deleted while its calls run', async () => {
    const { t, themeId } = await probeTenant();
    const [firstId] = await launch(t);
    await answered(t, firstId!);
    await label(t, labeller(first));
    const fit = await db
      .selectFrom('probe_objection_groups')
      .select('id')
      .where('project_id', '=', t.projectId)
      .where('name', '=', 'Fit runs small')
      .executeTakeFirstOrThrow();
    const [secondId] = await launch(t);
    await answered(t, secondId!);
    let deleted = false;
    await label(
      t,
      labeller(first, async () => {
        if (deleted) return;
        deleted = true;
        await deleteTheme(db, { ...t, themeId });
        await db.deleteFrom('probe_objection_groups').where('id', '=', fit.id).execute();
      }),
    );
    const labellings = await db
      .selectFrom('probe_labellings')
      .select('outcome')
      .where('workspace_id', '=', t.workspaceId)
      .execute();
    expect(labellings).toEqual([{ outcome: 'labelled' }, { outcome: 'labelled' }]);
    const market = await probeMarket(db, t);
    const objections = await probeObjections(db, t);
    expect([
      market.state === 'value' ? market.known_for.map(({ theme }) => theme) : null,
      objections.state === 'value' ? objections.groups.map(({ name }) => name) : null,
    ]).toEqual([['Other'], ['Too expensive']]);
  });

  it('leaves a probe that answered nothing unlabelled, so the reads keep the last labelled one', async () => {
    const { t } = await probeTenant();
    const [firstId] = await launch(t);
    await answered(t, firstId!);
    await label(t, labeller(first));
    const [failedId] = await launch(t);
    await ended(t, failedId!, 'cancelled');
    await label(t, labeller(first));
    const market = await probeMarket(db, t);
    expect(market.state === 'value' ? market.probe.launch_id : null).toBe(await launchOf(firstId!));
  });

  it('refuses to repair a probe run: a new probe is its retry', async () => {
    const { t } = await probeTenant();
    const [auditId] = await launch(t);
    await ended(t, auditId!, 'cancelled');
    await expect(createRepairAudit(db, t.workspaceId, auditId!, {}, runtime)).rejects.toMatchObject(
      { status: 409 },
    );
  });

  it("seeds an Agent chat with one objection and its answers' cited sources, in its workspace only", async () => {
    const owner = await probeTenant();
    const other = await probeTenant();
    const [auditId] = await launch(owner.t);
    await answered(owner.t, auditId);
    await label(owner.t, labeller(first));
    const tasks = await db
      .selectFrom('audit_tasks')
      .select('id')
      .where('audit_id', '=', auditId)
      .execute();
    for (const task of tasks)
      await fixtures.analysis(
        owner.t,
        {
          auditId,
          analysis: { citations: [{ url: 'https://reviews.test/acme', title: 'Acme review' }] },
        },
        task.id,
        'chatgpt',
        'test',
      );
    const fit = await db
      .selectFrom('probe_objection_groups')
      .select('id')
      .where('project_id', '=', owner.t.projectId)
      .where('name', '=', 'Fit runs small')
      .executeTakeFirstOrThrow();
    const context = await readAgentContext(
      db,
      owner.t,
      { objection_group_id: fit.id },
      'Help me answer it',
    );
    expect(context.sections?.objection).toMatchObject({
      name: 'Fit runs small',
      score: 63,
      engines: ['chatgpt'],
      sources: 1,
      pages: [
        {
          url: 'https://reviews.test/acme',
          title: 'Acme review',
          classification: 'third_party',
          citations: 2,
        },
      ],
    });
    await expect(
      readAgentContext(db, other.t, { objection_group_id: fit.id }, 'Help me answer it'),
    ).rejects.toMatchObject({ code: 'agent_context_unavailable' });
  });
});
