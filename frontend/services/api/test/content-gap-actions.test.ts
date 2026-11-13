/**
 * The `content_gaps` refresh family against real PostgreSQL: which angles
 * become gaps, the Actions they land on (ordinary Actions on the one list),
 * retention across failed, empty and old runs, lineage identity,
 * planned-to-owned continuity and workspace isolation. Angle runs are seeded
 * directly; nothing calls a model.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { record } from '../src/db/json.ts';
import { attachOrCreateAction, getAction, listActions } from '../src/opportunities/actions.ts';
import { declareAction } from '../src/opportunities/declarations.ts';
import { recomputeOpportunities } from '../src/opportunities/refresh.ts';
import { angleRun, type AngleSeed } from './opportunity-fixtures.ts';
import { prompt, promptSet } from './prompt-fixtures.ts';
import { SiteFixtures, storedFacts, type SiteSeed } from './site-health-fixtures.ts';
import { testDatabase } from './support.ts';

const db = testDatabase();
const fixtures = new SiteFixtures(db);
const projects: Project[] = [];
const DAY = 86_400_000;
const PAGE_URL = 'https://example.test/crm-pricing';

afterAll(async () => {
  const workspaces = projects.map((p) => p.workspaceId);
  for (const table of [
    'opportunity_implementation_events',
    'action_status_events',
    'opportunities',
    'actions',
    'opportunity_snapshots',
    'analytics_tasks',
  ] as const)
    await db.deleteFrom(table).where('workspace_id', 'in', workspaces).execute();
  await fixtures.cleanup();
  await db.destroy();
});

type Project = SiteSeed & { pageId: string };

/** A crawled project with one content page (a comparison) at PAGE_URL. */
async function project(): Promise<Project> {
  const seed = await fixtures.crawl();
  const page = await fixtures.page(seed, '/crm-pricing', storedFacts({ title: 'CRM pricing' }));
  await db
    .updateTable('site_page_analyses')
    .set({ page_kind: 'comparison' })
    .where('workspace_id', '=', seed.workspaceId)
    .where('id', '=', page.analysisId)
    .execute();
  const created = { ...seed, pageId: page.id };
  projects.push(created);
  return created;
}

const scopeOf = (p: Project) => ({ workspaceId: p.workspaceId, projectId: p.projectId });

// Four citations across two domains: above both placeholder thresholds.
const PRICING = [
  { url: 'https://globex.com/pricing', title: 'Globex pricing', competitor: true },
  { url: 'https://review.example/crm-pricing', title: 'CRM pricing compared' },
];
const SETUP = [
  { url: 'https://globex.com/setup', title: 'Globex setup guide', competitor: true },
  { url: 'https://news.example/crm-setup', title: 'How to set up a CRM' },
];

const improve = (p: Project, extra: Partial<AngleSeed> = {}): AngleSeed => ({
  label: 'Pricing comparison',
  siteUrlId: p.pageId,
  members: PRICING,
  ...extra,
});
const create = (extra: Partial<AngleSeed> = {}): AngleSeed => ({
  label: 'Setup guide',
  members: SETUP,
  ...extra,
});

const run = (p: Project, options: Parameters<typeof angleRun>[2]) =>
  angleRun(db, scopeOf(p), options);

/** The live content-gap findings, as [rule, target key, Action id]. */
async function gaps(p: Project) {
  const rows = await db
    .selectFrom('opportunities')
    .select(['rule_id', 'target_key', 'action_id', 'evidence'])
    .where('workspace_id', '=', p.workspaceId)
    .where('rule_id', 'like', 'content_gap_%')
    .where('superseded_at', 'is', null)
    .orderBy('rule_id')
    .execute();
  return rows;
}

async function actions(p: Project) {
  return db
    .selectFrom('actions')
    .select([
      'id',
      'target_kind',
      'target_label',
      'origin',
      'evidence_cleared_at',
      'member_opportunity_ids',
    ])
    .where('workspace_id', '=', p.workspaceId)
    .orderBy('target_kind')
    .orderBy('target_label')
    .execute();
}

async function plannedKeys(p: Project, lineages: string[]) {
  const rows = await db
    .selectFrom('content_angle_lineages')
    .select(['id', 'planned_page_key'])
    .where('workspace_id', '=', p.workspaceId)
    .where('id', 'in', lineages)
    .execute();
  return lineages.map((id) => rows.find((row) => row.id === id)?.planned_page_key);
}

describe('content gaps', () => {
  it('raises improve-page and new-page gaps as Actions on their page and planned page', async () => {
    const p = await project();
    const { runId, lineages } = await run(p, {
      angles: [
        improve(p),
        create(),
        // Covered: the matched page is already cited for the angle's prompts.
        improve(p, { label: 'Pricing tiers', ownedCited: true }),
        // Below the domain minimum.
        { label: 'Thin', members: [{ url: 'https://solo.example/a', title: 'A', citations: 5 }] },
      ],
    });
    await recomputeOpportunities(db, scopeOf(p));

    const found = await gaps(p);
    expect(found.map((row) => [row.rule_id, row.target_key])).toEqual([
      ['content_gap_improve_page', `url:${PAGE_URL}`],
      ['content_gap_new_page', 'planned:setup-guide'],
    ]);
    expect(record(found[1]!.evidence)).toMatchObject({
      run_id: runId,
      lineage_id: lineages[1],
      angle_label: 'Setup guide',
      citation_count: 4,
      domain_count: 2,
      competitor_count: 1,
      planned_page_key: 'planned:setup-guide',
      members: [
        expect.objectContaining({ url: 'https://globex.com/setup', citation_count: 2 }),
        expect.objectContaining({ url: 'https://news.example/crm-setup', citation_count: 2 }),
      ],
    });
    expect((await actions(p)).map((row) => [row.target_kind, row.target_label])).toEqual([
      ['page', PAGE_URL],
      ['planned_page', 'Setup guide'],
    ]);
  });

  it('returns each gap with its evidence, and the Agent handoff, on the Action read', async () => {
    const p = await project();
    await run(p, { angles: [improve(p), create()] });
    await recomputeOpportunities(db, scopeOf(p));
    const [pageAction, plannedAction] = await actions(p);
    const page = await getAction(db, p.workspaceId, pageAction!.id);
    const planned = await getAction(db, p.workspaceId, plannedAction!.id);
    const newPage = await db
      .selectFrom('opportunities')
      .select('id')
      .where('workspace_id', '=', p.workspaceId)
      .where('rule_id', '=', 'content_gap_new_page')
      .where('superseded_at', 'is', null)
      .executeTakeFirstOrThrow();

    expect(planned.handoff).toEqual({
      context: 'opportunity',
      workflow_id: 'article',
      opportunity_id: newPage.id,
      message: 'Write a page about Setup guide for the prompts in this Action.',
    });
    expect(page.handoff).toEqual({
      context: 'page_url',
      workflow_id: 'optimize_page',
      message: `Improve ${PAGE_URL} so AI answers cite it for Pricing comparison.`,
    });
    expect(
      [page, planned].map((action) =>
        action.members.map((member) => [
          member.rule_id,
          member.content_gap_evidence?.angle_label,
          member.content_gap_evidence?.members.map((cited) => cited.url),
        ]),
      ),
    ).toEqual([
      [
        [
          'content_gap_improve_page',
          'Pricing comparison',
          ['https://globex.com/pricing', 'https://review.example/crm-pricing'],
        ],
      ],
      [
        [
          'content_gap_new_page',
          'Setup guide',
          ['https://globex.com/setup', 'https://news.example/crm-setup'],
        ],
      ],
    ]);
  });

  it('keeps gaps after a failed run and clears them on a succeeded run with none', async () => {
    const p = await project();
    await run(p, { angles: [improve(p)] });
    const first = await recomputeOpportunities(db, scopeOf(p));
    const [action] = await actions(p);

    await run(p, { outcome: 'failed' });
    const afterFailure = await recomputeOpportunities(db, scopeOf(p), { skipIfCurrent: true });
    expect(afterFailure.id).toBe(first.id);
    expect((await gaps(p)).map((row) => row.action_id)).toEqual([action!.id]);

    await run(p, { angles: [] });
    const empty = await recomputeOpportunities(db, scopeOf(p), { skipIfCurrent: true });
    expect(await gaps(p)).toEqual([]);
    const [cleared] = await actions(p);
    expect([cleared?.id, cleared?.member_opportunity_ids]).toEqual([action!.id, []]);
    expect(cleared?.evidence_cleared_at).toBeInstanceOf(Date);
    const listed = await listActions(db, scopeOf(p), {
      status: null,
      target_kind: null,
      limit: 10,
      cursor: null,
    });
    expect(listed.items).toEqual([]);
    // A current run with no gaps: a real "no gaps", with no content-gap limitation.
    expect(empty.limitations.filter((text) => text.startsWith('Content'))).toEqual([]);
  });

  it('says when gaps were never computed, and clears gaps whose run is out of date', async () => {
    const p = await project();
    const never = await recomputeOpportunities(db, scopeOf(p));
    expect(never.limitations).toContain('Content gaps not computed yet.');

    const { runId } = await run(p, { angles: [improve(p)] });
    await recomputeOpportunities(db, scopeOf(p));
    expect(await gaps(p)).toHaveLength(1);

    // Time passes: the run's newest audit is now 46 days old.
    await db
      .updateTable('content_angle_runs')
      .set({ window_end: new Date(Date.now() - 46 * DAY) })
      .where('id', '=', runId)
      .execute();
    const stale = await recomputeOpportunities(db, scopeOf(p), { skipIfCurrent: true });
    expect(await gaps(p)).toEqual([]);
    expect(stale.limitations).toContain(
      'Content-gap evidence is out of date: its newest audit is more than 45 days old.',
    );
  });

  it('stores each angle prompt with its text, and records a deleted prompt without one', async () => {
    const p = await project();
    const kept = await prompt(
      db,
      await promptSet(db, p.projectId),
      'best crm pricing for startups',
    );
    // An id the library no longer has (or never had in this project).
    const gone = randomUUID();
    await run(p, { angles: [improve(p, { promptIds: [kept, gone] })] });
    await recomputeOpportunities(db, scopeOf(p));

    const [found] = await gaps(p);
    // In the run's stored order.
    expect(record(found!.evidence).prompts).toEqual([
      { id: kept, text: 'best crm pricing for startups' },
      { id: gone, text: null },
    ]);
  });

  it('keeps the Action and planned key of a relabelled angle', async () => {
    const p = await project();
    const { lineages } = await run(p, { angles: [create()] });
    await recomputeOpportunities(db, scopeOf(p));
    const [planned] = await actions(p);

    await run(p, {
      angles: [create({ label: 'CRM onboarding checklist', lineageId: lineages[0] })],
    });
    await recomputeOpportunities(db, scopeOf(p));
    expect((await gaps(p)).map((row) => [row.target_key, row.action_id])).toEqual([
      ['planned:setup-guide', planned!.id],
    ]);
    expect((await actions(p)).map((row) => [row.id, row.target_label])).toEqual([
      [planned!.id, 'CRM onboarding checklist'],
    ]);
    expect(await plannedKeys(p, lineages)).toEqual(['planned:setup-guide']);
  });

  it('converges an Agent planned page with the gap that names it', async () => {
    const p = await project();
    const attach = (kind: string, target: string) =>
      db
        .transaction()
        .execute((trx) => attachOrCreateAction(trx, scopeOf(p), kind, target, p.userId));
    const agent = await attach('planned_page', 'Setup guide');
    const other = await attach('planned_page', 'Pricing calculator');

    await run(p, { angles: [create()] });
    await recomputeOpportunities(db, scopeOf(p));
    expect((await actions(p)).map((row) => [row.id, row.origin, row.target_kind])).toEqual([
      [other.id, 'agent', 'planned_page'],
      [agent.id, 'agent', 'planned_page'],
    ]);
    expect((await gaps(p)).map((row) => row.action_id)).toEqual([agent.id]);
  });

  it('continues a declared planned page on the content page that later covers it', async () => {
    const p = await project();
    const { lineages } = await run(p, { angles: [create()] });
    await recomputeOpportunities(db, scopeOf(p));
    const [planned] = await actions(p);
    await declareAction(
      db,
      { workspaceId: p.workspaceId, projectId: null },
      planned!.id,
      p.userId,
      'planned',
      {
        output_revision_id: null,
        declared_implemented_at: new Date(Date.now() - DAY).toISOString(),
      },
    );

    await run(p, { angles: [create({ lineageId: lineages[0], siteUrlId: p.pageId })] });
    await recomputeOpportunities(db, scopeOf(p));
    const found = await gaps(p);
    expect(found.map((row) => row.rule_id)).toEqual(['content_gap_improve_page']);
    expect(record(found[0]!.evidence).continues_action_id).toBe(planned!.id);
    const after = await actions(p);
    const kept = after.find((row) => row.id === planned!.id);
    expect([kept?.target_kind, kept?.member_opportunity_ids]).toEqual(['planned_page', []]);
    expect(kept?.evidence_cleared_at).toBeInstanceOf(Date);
    const declarations = await db
      .selectFrom('opportunity_implementation_events')
      .select('action_id')
      .where('workspace_id', '=', p.workspaceId)
      .execute();
    expect(declarations).toEqual([{ action_id: planned!.id }]);
  });

  it('lists content-gap Actions with every other Action, within one workspace', async () => {
    const own = await project();
    const foreign = await project();
    for (const p of [own, foreign]) {
      await run(p, { angles: [improve(p), create()] });
      await db
        .transaction()
        .execute((trx) =>
          attachOrCreateAction(trx, scopeOf(p), 'planned_page', 'Pricing calculator', p.userId),
        );
      await recomputeOpportunities(db, scopeOf(p));
    }
    const listed = await listActions(db, scopeOf(own), {
      status: null,
      target_kind: null,
      limit: 10,
      cursor: null,
    });
    const ownIds = new Set((await actions(own)).map((row) => row.id));
    expect(listed.items.map((item) => [item.target_kind, item.target_label]).sort()).toEqual([
      ['page', PAGE_URL],
      ['planned_page', 'Pricing calculator'],
      ['planned_page', 'Setup guide'],
    ]);
    expect(listed.items.every((item) => ownIds.has(item.id))).toBe(true);
    expect(listed.status_counts.open).toBe(3);
  });
});
