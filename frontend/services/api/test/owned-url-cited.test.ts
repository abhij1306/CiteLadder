/**
 * The `owned_url_cited` declaration check against real PostgreSQL: what a
 * content-gap declaration freezes, how a later visibility run reads it through
 * the verification worker, and what the Action detail then says. Content-angle
 * runs and audits are seeded directly; nothing calls a provider or a model.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';

import { getAction } from '../src/opportunities/actions.ts';
import { declareAction } from '../src/opportunities/declarations.ts';
import { enqueueImplementationVerification } from '../src/opportunities/enqueue.ts';
import { recomputeOpportunities } from '../src/opportunities/refresh.ts';
import { drainWorkspace } from './analytics-drain.ts';
import { angleRun, seedOpportunityScenario, type OpportunitySeed } from './opportunity-fixtures.ts';
import { prompt } from './prompt-fixtures.ts';
import { SiteFixtures } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
const seeds: OpportunitySeed[] = [];
const DAY = 86_400_000;
const PAGE = 'https://acme.test/a';
const OTHER_PAGE = 'https://acme.test/b';
const ALREADY_CITED = 'https://acme.com/guide';

afterAll(async () => {
  for (const seed of seeds) {
    await db.deleteFrom('workspaces').where('id', '=', seed.workspace_id).execute();
    await db.deleteFrom('users').where('id', '=', seed.user_id).execute();
  }
  await db.destroy();
});

type Project = OpportunitySeed & { pageId: string; otherPageId: string };
const scopeOf = (p: Project) => ({ workspaceId: p.workspace_id, projectId: p.project_id });
const tenantOf = (p: Project) => ({ ...scopeOf(p), userId: p.user_id });
const goLive = () => new Date(Date.now() - 2 * DAY).toISOString();

/**
 * The opportunity scenario: its audit (three days ago, before go-live)
 * answered the first prompt with a competitor page and the second with an
 * owned page, acme.com/guide.
 */
async function project(): Promise<Project> {
  const seed = await seedOpportunityScenario(db);
  seeds.push(seed);
  await db
    .updateTable('audits')
    .set({ completed_at: new Date(Date.now() - 3 * DAY) })
    .where('id', '=', seed.audit_id)
    .execute();
  const pages = await db
    .selectFrom('site_urls')
    .select(['id', 'normalized_url'])
    .where('workspace_id', '=', seed.workspace_id)
    .execute();
  const id = (url: string) => pages.find((page) => page.normalized_url === url)!.id;
  return { ...seed, pageId: id(PAGE), otherPageId: id(OTHER_PAGE) };
}

const PRICING = [
  { url: 'https://globex.com/pricing', title: 'Globex pricing', competitor: true },
  { url: 'https://review.example/crm-pricing', title: 'CRM pricing compared' },
];
const SETUP = [
  { url: 'https://globex.com/setup', title: 'Globex setup guide', competitor: true },
  { url: 'https://news.example/crm-setup', title: 'How to set up a CRM' },
];

/** Gaps on the page at PAGE and on a planned page, both over the scenario's two prompts. */
async function gaps(p: Project) {
  const prompts = [p.prompt0_id, p.prompt1_id];
  const { lineages } = await angleRun(db, scopeOf(p), {
    angles: [
      { label: 'Pricing comparison', siteUrlId: p.pageId, members: PRICING, promptIds: prompts },
      { label: 'Setup guide', members: SETUP, promptIds: prompts },
    ],
  });
  await recomputeOpportunities(db, scopeOf(p));
  const actions = await db
    .selectFrom('actions')
    .select(['id', 'target_kind', 'target_label'])
    .where('workspace_id', '=', p.workspace_id)
    .execute();
  const improve = actions.find((row) => row.target_label === PAGE)!.id;
  const planned = actions.find((row) => row.target_kind === 'planned_page')!.id;
  return { improve, planned, lineages };
}

function declare(p: Project, actionId: string, revision: string | null = null) {
  return declareAction(
    db,
    { workspaceId: p.workspace_id, projectId: null },
    actionId,
    p.user_id,
    randomUUID(),
    { output_revision_id: revision, declared_implemented_at: goLive() },
  );
}

/** One owned or third-party URL an answer cites. */
type Cited = { url: string; owned?: boolean };

/**
 * A visibility run after go-live answering each listed prompt once with the
 * listed citations, then the verification worker reading it.
 */
async function laterRun(
  p: Project,
  answers: [promptId: string, cited: Cited[]][],
  at = new Date(),
) {
  const auditId = await fixtures.audit(tenantOf(p), { completedAt: at });
  for (const [index, [promptId, cited]] of answers.entries()) {
    await fixtures.execution(tenantOf(p), {
      auditId,
      promptIndex: index,
      analysis: {
        citations: cited.map((item) => ({ url: item.url, isOwned: item.owned ?? true })),
      },
    });
    await db
      .updateTable('audit_prompt_snapshots')
      .set({ prompt_id: promptId })
      .where('audit_id', '=', auditId)
      .where('prompt_index', '=', index)
      .execute();
  }
  await enqueueImplementationVerification(db, {
    ...scopeOf(p),
    triggerKind: 'audit',
    triggerId: auditId,
    maxAttempts: 3,
  });
  await drainWorkspace(db, p.workspace_id, { owner: `owned-url-cited-${randomUUID()}` });
  return auditId;
}

/** The Action detail's owned-URL check, as a reader sees it. */
async function citedCheck(p: Project, actionId: string) {
  const detail = await getAction(db, p.workspace_id, actionId);
  const check = detail.declaration?.checks.find((item) => item.kind === 'owned_url_cited');
  return check && { state: check.state, reason: check.reason, subject: check.subject };
}

async function frozen(actionId: string) {
  const row = await db
    .selectFrom('opportunity_implementation_events')
    .select('expected_checks')
    .where('action_id', '=', actionId)
    .executeTakeFirstOrThrow();
  return (row.expected_checks as { kind: string }[]).filter(
    (check) => check.kind === 'owned_url_cited',
  );
}

describe('owned_url_cited', () => {
  it('freezes an improved page with its prompts and is met once a later run cites it', async () => {
    const p = await project();
    const { improve, lineages } = await gaps(p);
    await declare(p, improve);

    expect(await frozen(improve)).toEqual([
      {
        kind: 'owned_url_cited',
        prompt_ids: [p.prompt0_id, p.prompt1_id].sort(),
        lineage_id: lineages[0],
        expectation: { target: 'page', url: PAGE, site_url_id: p.pageId },
      },
    ]);
    // No run after go-live yet: waiting, never unmet.
    expect(await citedCheck(p, improve)).toEqual({ state: 'waiting', reason: null, subject: PAGE });

    await laterRun(p, [
      [p.prompt0_id, [{ url: 'https://globex.com/crm', owned: false }]],
      [p.prompt1_id, [{ url: ALREADY_CITED }]],
    ]);
    expect(await citedCheck(p, improve)).toEqual({ state: 'unmet', reason: null, subject: PAGE });

    await laterRun(p, [[p.prompt0_id, [{ url: `${PAGE}?utm_source=chatgpt` }]]]);
    expect(await citedCheck(p, improve)).toEqual({ state: 'met', reason: null, subject: PAGE });
  });

  it('meets a new page only with an owned URL outside those cited before go-live', async () => {
    const p = await project();
    const { planned } = await gaps(p);
    await declare(p, planned);

    const [check] = await frozen(planned);
    expect(check).toMatchObject({
      prompt_ids: [p.prompt0_id, p.prompt1_id].sort(),
      expectation: {
        target: 'new_page',
        baseline_audit_ids: [p.audit_id],
        baseline_urls: [ALREADY_CITED],
      },
    });
    expect(await citedCheck(p, planned)).toEqual({ state: 'waiting', reason: null, subject: null });

    // An owned page that was already cited is not the new page.
    await laterRun(p, [[p.prompt1_id, [{ url: ALREADY_CITED }]]]);
    expect(await citedCheck(p, planned)).toEqual({ state: 'unmet', reason: null, subject: null });

    // A new third-party page is not yours either; a new owned one is.
    await laterRun(p, [
      [p.prompt0_id, [{ url: 'https://news.example/new-guide', owned: false }]],
      [p.prompt1_id, [{ url: 'https://acme.test/crm-setup-guide' }]],
    ]);
    expect(await citedCheck(p, planned)).toEqual({ state: 'met', reason: null, subject: null });
  });

  it('keeps measuring what was frozen after the angle is rematched and its prompts change', async () => {
    const p = await project();
    const { improve, lineages } = await gaps(p);
    await declare(p, improve);
    const before = await frozen(improve);

    // The lineage now matches another page on only the second prompt.
    await angleRun(db, scopeOf(p), {
      angles: [
        {
          label: 'Pricing tiers',
          lineageId: lineages[0],
          siteUrlId: p.otherPageId,
          members: PRICING,
          promptIds: [p.prompt1_id],
        },
      ],
    });
    await recomputeOpportunities(db, scopeOf(p));
    expect(await frozen(improve)).toEqual(before);

    await laterRun(p, [[p.prompt1_id, [{ url: OTHER_PAGE }]]]);
    expect(await citedCheck(p, improve)).toMatchObject({ state: 'unmet' });
    await laterRun(p, [[p.prompt0_id, [{ url: PAGE }]]]);
    expect(await citedCheck(p, improve)).toMatchObject({ state: 'met' });
  });

  it('cannot answer from a run that asked none of the prompts, so a deleted prompt never reads as unmet', async () => {
    const p = await project();
    const { improve } = await gaps(p);
    await declare(p, improve);
    // Both prompts are deleted after declaration; later runs ask another one.
    const { prompt_set_id: setId } = await db
      .selectFrom('prompts')
      .select('prompt_set_id')
      .where('id', '=', p.prompt0_id)
      .executeTakeFirstOrThrow();
    const replacement = await prompt(db, setId, 'crm pricing for agencies');
    await db.deleteFrom('prompts').where('id', 'in', [p.prompt0_id, p.prompt1_id]).execute();
    await laterRun(p, [[replacement, [{ url: PAGE }]]]);
    expect(await citedCheck(p, improve)).toEqual({
      state: 'unavailable',
      reason: 'prompts_not_in_run',
      subject: PAGE,
    });
  });

  it('freezes the page and prompts an Analyze a page chat was started for', async () => {
    const p = await project();
    const { improve } = await gaps(p);
    const revision = await analysisRevision(p, improve, [p.prompt1_id]);
    await declare(p, improve, revision);

    expect(await frozen(improve)).toEqual([
      expect.objectContaining({ prompt_ids: [p.prompt0_id, p.prompt1_id].sort() }),
      {
        kind: 'owned_url_cited',
        prompt_ids: [p.prompt1_id],
        lineage_id: null,
        expectation: { target: 'page', url: PAGE, site_url_id: p.pageId },
      },
    ]);
  });

  it("reads only this workspace's runs, and freezes only its own citations as the baseline", async () => {
    const own = await project();
    const foreign = await project();
    const { planned } = await gaps(own);
    // Another workspace's run cannot name this project's prompt at all.
    await expect(
      laterRun(foreign, [[own.prompt1_id, [{ url: 'https://acme.test/elsewhere' }]]]),
    ).rejects.toMatchObject({ code: '23503' });
    // Another workspace's run before go-live.
    await laterRun(
      foreign,
      [[foreign.prompt1_id, [{ url: 'https://acme.test/elsewhere' }]]],
      new Date(Date.now() - 2.5 * DAY),
    );
    await declare(own, planned);
    expect((await frozen(planned))[0]).toMatchObject({
      expectation: { baseline_urls: [ALREADY_CITED], baseline_audit_ids: [own.audit_id] },
    });

    // Its run citing the page after go-live, even when announced to this project, is never read.
    const foreignRun = await laterRun(foreign, [
      [foreign.prompt1_id, [{ url: 'https://acme.test/crm-setup-guide' }]],
    ]);
    await enqueueAndDrain(own, foreignRun);
    expect(await citedCheck(own, planned)).toEqual({
      state: 'waiting',
      reason: null,
      subject: null,
    });

    await laterRun(own, [[own.prompt1_id, [{ url: 'https://acme.test/crm-setup-guide' }]]]);
    expect(await citedCheck(own, planned)).toMatchObject({ state: 'met' });
  });
});

/** Another workspace's run announced to this project: the worker must refuse to read it. */
async function enqueueAndDrain(p: Project, auditId: string) {
  await enqueueImplementationVerification(db, {
    ...scopeOf(p),
    triggerKind: 'audit',
    triggerId: auditId,
    maxAttempts: 1,
  });
  await drainWorkspace(db, p.workspace_id, { owner: `owned-url-cited-${randomUUID()}` });
}

/**
 * The output revision of an Analyze a page chat on this Action, started for
 * the page at PAGE and these prompts.
 */
async function analysisRevision(p: Project, actionId: string, promptIds: string[]) {
  const scope = { workspace_id: p.workspace_id, project_id: p.project_id };
  const now = new Date();
  const chatId = randomUUID();
  const outputId = randomUUID();
  const revisionId = randomUUID();
  await db
    .insertInto('agent_chats')
    .values({
      ...scope,
      id: chatId,
      action_id: actionId,
      title: 'Optimize page',
      context_refs: sql`${JSON.stringify({
        target_url: PAGE,
        target_site_url_id: p.pageId,
        prompt_reference: { topic_id: randomUUID(), prompt_ids: promptIds },
      })}::jsonb`,
      turn_count: 0,
      last_activity_at: now,
      created_at: now,
      updated_at: now,
    })
    .execute();
  await db
    .insertInto('agent_outputs')
    .values({
      ...scope,
      id: outputId,
      chat_id: chatId,
      number: 1,
      action_id: actionId,
      kind: 'page',
      skill_id: 'content_optimize',
      created_at: now,
      updated_at: now,
    })
    .execute();
  await db
    .insertInto('agent_output_revisions')
    .values({
      ...scope,
      id: revisionId,
      output_id: outputId,
      number: 1,
      author: 'run',
      title: 'Page',
      body: 'The page.',
      source_refs: '[]',
      created_at: now,
    })
    .execute();
  return revisionId;
}
