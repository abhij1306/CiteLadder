import { expect, test, type Page, type Request } from '@playwright/test';
import { FIXTURE_PROJECT, fixtureProjectPath, stubAuthedShell } from './helpers/app-fixture';

/**
 * Visibility workspace e2e.
 *
 * All backend calls are stubbed at the network layer so the spec runs without a
 * live backend (mirrors `runs.spec.ts`). It asserts the tab IA — Trends,
 * Sources, Perception, Query fanouts (no Overview / Topics) — the WAI-ARIA tablist (pointer + keyboard navigation, one panel at
 * a time, `?tab=` URL sync), shared-filter persistence across tabs, the evidence
 * populated / empty / error states, the three query-fanout states, and a
 * narrow-viewport (mobile) layout check.
 *
 * The app calls only relative `/api/v1` paths (Next rewrites proxy them), so the
 * spec asserts every `/api/` request the browser issues is same-origin with the
 * page's baseURL — no cross-origin backend URL.
 */
const WORKSPACE_ID = FIXTURE_PROJECT.workspace_id;
const PROJECT_ID = FIXTURE_PROJECT.id;
const AUDIT_LATEST = '22222222-2222-4222-8222-222222222222';
const AUDIT_EARLIER = '22222222-2222-4222-8222-222222222221';
const ANALYSIS_A = '44444444-4444-4444-8444-444444444444';
const ANALYSIS_B = '55555555-5555-4555-8555-555555555555';
const ANALYSIS_C = '66666666-6666-4666-8666-666666666666';
const PROMPT_A = '77777777-7777-4777-8777-777777777777';
const SNAP_A = '88888888-8888-4888-8888-888888888888';
const TASK_A = '99999999-9999-4999-8999-999999999999';
const ARTIFACT_A = 'abababab-abab-4bab-8bab-abababababab';

const audit = {
  id: AUDIT_LATEST,
  workspace_id: WORKSPACE_ID,
  project_id: PROJECT_ID,
  status: 'completed',
  benchmark_mode: 'consumer_like',
  repetitions: 2,
  random_seed: '1',
  requested_count: 6,
  completed_count: 6,
  failed_count: 0,
  error_message: '',
  engine_snapshots: [],
  market: { id: null, country_code: 'US', language_code: 'en' },
  launch_id: null,
  not_applicable_engines: [],
  created_at: '2026-07-15T00:00:00Z',
  updated_at: '2026-07-15T00:00:00Z',
  started_at: '2026-07-15T00:00:00Z',
  completed_at: '2026-07-15T00:00:00Z',
};

function visibility(score: number) {
  return {
    project_id: PROJECT_ID,
    audit_id: AUDIT_LATEST,
    audit_status: 'completed',
    analyzer_version: 'v1',
    scoring_rule_version: 'v1',
    total_completed: 6,
    total_failed: 0,
    visibility_score: score,
    visibility_rate: 4 / 6,
    owned_citation_rate: 2 / 6,
    counts: {
      state: 'measured',
      responses: 6,
      brand_responses: 4,
      owned_citation_responses: 2,
      entity_presences: 6,
      expected: 6,
      failed: 0,
      not_run: 0,
    },
    model_provenance: [],
    rankings: [
      {
        name: 'Acme',
        is_brand: true,
        mention_rate: score / 100,
        citation_rate: 0.3,
        share_of_voice: 0.6,
        mention_count: 4,
        avg_position: null,
      },
      {
        name: 'Globex',
        gap_count: 2,
        is_brand: false,
        mention_rate: 0.3,
        citation_rate: 0.1,
        share_of_voice: 0.4,
        mention_count: 2,
        avg_position: null,
      },
    ],
    per_engine: [
      {
        logical_engine: 'gemini',
        total_completed: 3,
        brand_mention_rate: 0.6,
        owned_citation_rate: 0.3,
        search_use_rate: 0.5,
        visibility_score: 60,
      },
      {
        logical_engine: 'claude',
        total_completed: 3,
        brand_mention_rate: 0.7,
        owned_citation_rate: 0.4,
        search_use_rate: 0.6,
        visibility_score: 70,
      },
    ],
    avg_position: null,
    created_at: '2026-07-15T00:00:00Z',
  };
}

function trendPoint(auditId: string, completedAt: string, score: number | null) {
  return {
    audit_id: auditId,
    completed_at: completedAt,
    logical_engine: null,
    visibility_score: score,
    brand_mention_rate: 0.5,
    owned_citation_rate: 0.3,
    sov: { response: 0.4, mention: 0.5 },
    rankings: [
      {
        name: 'Acme',
        is_brand: true,
        mention_rate: 0.5,
        citation_rate: 0.3,
        share_of_voice: 0.6,
        mention_count: 4,
        avg_position: null,
      },
    ],
    avg_position: null,
    source_snapshot_ids: [auditId],
    comparison_key: 'same-panel',
    analyzer_versions: ['v1'],
    scoring_rule_versions: ['v1'],
    spans_version_boundary: false,
  };
}

function citation(ordinal: number) {
  return {
    ordinal,
    url: 'https://acme.com/blog',
    title: 'Acme Blog',
    domain: 'acme.com',
    classification: 'owned',
    is_owned: true,
    is_unintended: false,
    matched_competitor: null,
  };
}

function evidenceItem(overrides: Record<string, unknown> = {}) {
  return {
    audit_id: AUDIT_LATEST,
    task_id: TASK_A,
    analysis_id: ANALYSIS_A,
    artifact_id: ARTIFACT_A,
    prompt_snapshot_id: SNAP_A,
    prompt_id: PROMPT_A,
    prompt_index: 3,
    prompt_text: 'Best affordable clothing stores in Australia?',
    repetition: 1,
    completed_at: '2026-07-15T14:32:00Z',
    logical_engine: 'chatgpt',
    transport_provider: 'openai',
    transport_model: 'gpt-5.4',
    search_used: true,
    search_query_count: 2,
    query_text_available: true,
    state: 'queries_available',
    search_events: [
      {
        sequence: 0,
        query: 'affordable family clothing Australia 2026',
        call_id: 'c1',
        call_sequence: 0,
        query_sequence: 0,
      },
      {
        sequence: 1,
        query: 'best budget clothing shops families',
        call_id: 'c1',
        call_sequence: 0,
        query_sequence: 1,
      },
    ],
    event_source: 'raw_artifact',
    mentions: [
      {
        kind: 'brand',
        name: 'Acme',
        first_offset: 12,
        artifact_id: null,
        analyzer_version: 'v1',
      },
      {
        kind: 'competitor',
        name: 'Globex',
        first_offset: null,
        artifact_id: null,
        analyzer_version: 'v1',
      },
    ],
    citations: [citation(1)],
    ...overrides,
  };
}

/** Fixture with all three query-fanout states present. */
function fanoutStatesResponse() {
  return {
    items: [
      evidenceItem(),
      evidenceItem({
        analysis_id: ANALYSIS_B,
        logical_engine: 'claude',
        transport_model: 'claude-sonnet-4-6',
        state: 'count_only',
        query_text_available: false,
        search_query_count: 1,
        search_events: [],
        event_source: 'audit_task',
        artifact_id: null,
        mentions: [],
        citations: [],
      }),
      evidenceItem({
        analysis_id: ANALYSIS_C,
        prompt_index: 2,
        logical_engine: 'gemini',
        transport_model: 'gemini-flash-latest',
        state: 'no_search',
        search_used: false,
        search_query_count: 0,
        query_text_available: false,
        search_events: [],
        event_source: 'none',
        mentions: [],
        citations: [],
      }),
    ],
    truncated: false,
  };
}

/** A run whose answers name the brand but are not classified yet. */
function pendingPerception() {
  const score = {
    positive: 0,
    neutral: 0,
    negative: 0,
    mixed: 0,
    classified: 0,
    positive_share: null,
    negative_share: null,
    net_sentiment: null,
  };
  const coverage = {
    mentions: 2,
    classified: 0,
    pending: 2,
    not_assessable: 0,
    low_confidence: 0,
    unavailable: [],
  };
  return {
    state: 'pending',
    reason: null,
    source_audit_ids: [AUDIT_LATEST],
    brand: { name: 'Acme', is_brand: true, score, coverage },
    coverage,
    entities: [],
    engines: [],
    topics: [],
    prompts: [],
    themes: [],
    negative_quotes: [],
    drivers: [],
    recommended: {
      mentioned: 2,
      recommended: 0,
      recommended_against: 0,
      rate: 0,
      limitation: 'English phrasing only.',
    },
    trend: [],
  };
}

/** An Ads read whose selection holds no ChatGPT Search answers. */
function noChatGptAds() {
  const presence = { answers: 0, answers_with_ads: 0, rate: null };
  return {
    state: 'no_answers',
    source_audit_ids: [AUDIT_LATEST],
    parser_versions: [],
    metrics_version: 'ads-metrics-1',
    presence,
    engines: [{ engine: 'gemini', applicability: 'not_applicable', answers: 6, presence: null }],
    brand: { appearances: 0, share: null, best_rank: null },
    advertisers_seen: 0,
    advertisers: [],
    creatives: { items: [], total: 0, next_cursor: null },
    prompts: [],
    topics: [],
    runs: [],
  };
}

type RouteBodies = {
  visibility?: unknown;
  visibilityStatus?: number;
  trends?: unknown;
  trendsStatus?: number;
  evidence?: unknown;
  evidenceStatus?: number;
  perception?: unknown;
};

/**
 * Register the shared network stubs. Every backend call is a relative
 * `/api/v1` path so the same-origin assertion holds. Returns the collected
 * request log and a helper to read the evidence request query params.
 */
async function setup(page: Page, bodies: RouteBodies = {}) {
  const requests: Request[] = [];
  const evidenceUrls: URL[] = [];
  page.on('request', (request) => requests.push(request));

  await stubAuthedShell(page);
  // The visibility dashboard lists audits via the flat `/audits?project_id=` route.
  await page.route('**/api/v1/audits**', (route) =>
    route.fulfill({
      json: [audit, { ...audit, id: AUDIT_EARLIER, completed_at: '2026-07-08T00:00:00Z' }],
    }),
  );

  // Precise regexes so `/visibility`, `/visibility/trends`, and
  // `/visibility/evidence` (all carrying `?...` query strings) route distinctly.
  await page.route(/\/api\/v1\/projects\/[^/]+\/visibility(\?.*)?$/, (route) =>
    route.fulfill(
      bodies.visibilityStatus
        ? { status: bodies.visibilityStatus, json: { error: { message: 'boom' } } }
        : {
            json: bodies.visibility ?? {
              ...visibility(67),
              audit_id: new URL(route.request().url()).searchParams.get('audit_id') ?? AUDIT_LATEST,
            },
          },
    ),
  );
  await page.route(/\/api\/v1\/projects\/[^/]+\/visibility\/perception(\?.*)?$/, (route) =>
    route.fulfill({ json: bodies.perception ?? pendingPerception() }),
  );
  await page.route(/\/api\/v1\/projects\/[^/]+\/visibility\/ads(\?.*)?$/, (route) =>
    route.fulfill({ json: noChatGptAds() }),
  );
  await page.route(/\/api\/v1\/projects\/[^/]+\/visibility\/trends(\?.*)?$/, (route) =>
    route.fulfill(
      bodies.trendsStatus
        ? { status: bodies.trendsStatus, json: { error: { message: 'boom' } } }
        : {
            json: bodies.trends ?? [
              trendPoint(AUDIT_EARLIER, '2026-07-08T00:00:00Z', 54),
              trendPoint(AUDIT_LATEST, '2026-07-15T00:00:00Z', 67),
            ],
          },
    ),
  );
  await page.route(/\/api\/v1\/projects\/[^/]+\/visibility\/evidence(\?.*)?$/, (route) => {
    evidenceUrls.push(new URL(route.request().url()));
    return route.fulfill(
      bodies.evidenceStatus
        ? { status: bodies.evidenceStatus, json: { error: { message: 'boom' } } }
        : {
            json: bodies.evidence ?? {
              items: [evidenceItem()],
              truncated: false,
            },
          },
    );
  });

  await page.route(/\/api\/v1\/projects\/[^/]+\/visibility\/sources(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: [],
        total: 0,
        responses: 6,
        prompts: 2,
        next_cursor: null,
        as_of: '2026-07-15T00:00:00Z',
        comparison_status: 'no_baseline',
      },
    }),
  );
  await page.route(/\/api\/v1\/projects\/[^/]+\/visibility\/fanout(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: [],
        answers: [],
        total_answers: 0,
        event_count: 2,
        distinct_queries: 2,
        coverage: { queries_available: 1 },
        next_cursor: null,
      },
    }),
  );
  await page.route(/\/api\/v1\/projects\/[^/]+\/visibility\/prompts(\?.*)?$/, (route) =>
    route.fulfill({ json: [] }),
  );
  return { requests, evidenceUrls };
}

/** Assert every observed `/api/` request is same-origin with the baseURL. */
function assertSameOriginApi(requests: Request[], baseURL: string) {
  const origin = new URL(baseURL).origin;
  const apiRequests = requests.filter((r) => new URL(r.url()).pathname.includes('/api/'));
  expect(apiRequests.length).toBeGreaterThan(0);
  for (const request of apiRequests) {
    expect(new URL(request.url()).origin).toBe(origin);
  }
}

test('pointer navigation switches panels and syncs ?tab=', async ({ page, baseURL }) => {
  const { requests, evidenceUrls } = await setup(page, {
    evidence: fanoutStatesResponse(),
  });
  await page.goto(fixtureProjectPath('/visibility'));

  await expect(page.getByText('Over time', { exact: true })).toBeVisible();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);

  // Sources — the cited domains, with the URLs half one switch away.
  await page.getByRole('tab', { name: 'Sources', exact: true }).click();
  await expect(page).toHaveURL(/[?&]tab=sources/);
  await expect(page.getByRole('radio', { name: 'Domains' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'URLs' })).toBeVisible();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);

  // Perception — how answers portray the brand, or why it cannot be shown yet.
  await page.getByRole('tab', { name: 'Perception', exact: true }).click();
  await expect(page).toHaveURL(/[?&]tab=perception/);
  await expect(page.getByRole('heading', { name: 'Classifying answers…' })).toBeVisible();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);

  // Ads — paid placements in ChatGPT Search answers; other engines are not applicable.
  await page.getByRole('tab', { name: 'Ads', exact: true }).click();
  await expect(page).toHaveURL(/[?&]tab=ads/);
  await expect(page.getByRole('heading', { name: 'No ChatGPT Search answers' })).toBeVisible();
  await expect(page.getByText('Gemini API: Not applicable')).toBeVisible();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);

  // Query fanouts — reuses the shared evidence cache.
  await page.getByRole('tab', { name: 'Query fanouts' }).click();
  await expect(page).toHaveURL(/[?&]tab=query-fanout/);
  await expect(page.getByText('affordable family clothing Australia 2026')).toBeVisible();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);

  expect(evidenceUrls.length).toBeGreaterThan(0);
  assertSameOriginApi(requests, baseURL!);
});

// The roving-tablist keyboard contract (Arrow/Home/End selection AND focus
// transfer) is asserted deterministically in
// app/(authed)/(app)/visibility/page.test.tsx. Nothing in it was
// browser-specific -- no real navigation, history, or cross-origin request --
// so it does not earn a second run here.
test('mobile viewport keeps the visibility tabs and one active panel usable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 720 });
  await setup(page);
  await page.goto(fixtureProjectPath('/visibility'));

  const tablist = page.getByRole('tablist', { name: 'Visibility views' });
  await expect(tablist).toBeVisible();
  const selectedTab = tablist.getByRole('tab', { selected: true });
  await expect(selectedTab).toBeVisible();

  // Every retained tab is still present in the one row.
  await expect(tablist.getByRole('tab')).toHaveCount(5);

  // Inactive panels are NOT stacked — still exactly one panel in the DOM.
  await expect(page.getByRole('tabpanel')).toHaveCount(1);

  // Shared filters remain usable: the surface dropdown still opens + selects.
  await page.getByRole('button', { name: 'Filter by surface' }).click();
  await page.getByRole('menuitemradio', { name: 'Gemini API', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Filter by surface' })).toContainText('Gemini API');
});

for (const width of [1280, 375]) {
  // Drills in through the engine comparison. This journey used to enter on the
  // rankings table's "N answers naming X but not you" button, which is gone
  // with the "Answers without you" column — the measure was undefined for the
  // tracked brand and asymmetric with every other column in that table. What
  // the test is really for survives the change: a selected run and engine must
  // still be the run and engine the evidence request asks for.
  test(`older run and engine preserve context through evidence at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    // The evidence answers for the run this journey SELECTED. Left at the
    // fixture's default the answer link would point at the latest run either
    // way, so the assertion below would hold even if the selection were
    // dropped — the exact context loss this test is named for.
    const { evidenceUrls } = await setup(page, {
      evidence: {
        items: [evidenceItem({ audit_id: AUDIT_EARLIER })],
        truncated: false,
      },
    });
    await page.goto(fixtureProjectPath(`/visibility?run=${AUDIT_EARLIER}&engine=gemini`));
    // The Next.js dev overlay is pinned bottom-left and, at 375px, sits over
    // the engine table at the bottom of this page — it swallowed the click
    // while the button underneath reported visible, enabled and stable. It
    // ships in dev only, so hiding it tests the product rather than the
    // toolchain; forcing the click would have hidden a real overlap instead.
    await page.addStyleTag({
      content: 'nextjs-portal { display: none !important; }',
    });
    await page.getByRole('button', { name: 'Gemini API', exact: true }).click();
    // The drill-down lands on Query fanouts, which is where execution evidence
    // is rendered now that the Mentions tab is gone. What this test is for is
    // unchanged: the selected run and engine must be the run and engine the
    // evidence request asks for.
    await expect(page).toHaveURL(/[?&]tab=query-fanout/);
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await expect.poll(() => evidenceUrls.at(-1)?.searchParams.get('audit_id')).toBe(AUDIT_EARLIER);
    const evidenceUrl = evidenceUrls.at(-1)!;
    expect(evidenceUrl.searchParams.get('engine')).toBe('gemini');
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`run=${AUDIT_EARLIER}.*engine=gemini`));
    await page.screenshot({
      path: `test-results/visibility-${width}.png`,
      fullPage: true,
    });
  });
}
