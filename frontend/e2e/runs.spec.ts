import { expect, test } from '@playwright/test';
import { FIXTURE_PROJECT, fixtureProjectPath, stubAuthedShell } from './helpers/app-fixture';

/**
 * F10 Run/Executions explorer smoke: shell → open a run → open evidence.
 *
 * The `/auth/me`, `/projects`, `/audits*`, and `/executions/*` calls are stubbed
 * at the network layer so the spec runs without a live backend. It exercises the
 * in-run evidence drawer flow (shell → Runs → open run → open evidence).
 *
 * playwright.config.ts starts (or reuses) the dev server; if it cannot come up
 * the whole run fails to boot rather than skipping this spec.
 */
const PROJECT_ID = FIXTURE_PROJECT.id;
const WORKSPACE_ID = FIXTURE_PROJECT.workspace_id;
const AUDIT_ID = '44444444-4444-4444-8444-444444444444';
const EXEC_ID = '77777777-7777-4777-8777-777777777777';
const ANALYSIS_ID = '88888888-8888-4888-8888-888888888888';

const audit = {
  id: AUDIT_ID,
  workspace_id: WORKSPACE_ID,
  project_id: PROJECT_ID,
  status: 'completed',
  benchmark_mode: 'consumer_like',
  repetitions: 3,
  random_seed: '7',
  requested_count: 3,
  completed_count: 3,
  failed_count: 0,
  error_message: '',
  engine_snapshots: [],
  market: { id: null, country_code: 'US', language_code: 'en' },
  launch_id: null,
  not_applicable_engines: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  started_at: '2026-01-01T00:00:05Z',
  completed_at: '2026-01-01T00:10:00Z',
};

const execution = {
  id: EXEC_ID,
  audit_id: AUDIT_ID,
  prompt_index: 0,
  repetition: 1,
  randomized_position: 0,
  logical_engine: 'gemini',
  transport_provider: 'google',
  transport_model: 'gemini-flash-latest',
  status: 'succeeded',
  attempt_count: 1,
  max_attempts: 5,
  prompt_text: 'Which CRM is best for a growing team?',
  answer_text: 'Acme is a leading CRM.',
  search_used: true,
  error_code: '',
  error_detail: '',
  latency_ms: 900,
  created_at: '2026-01-01T00:00:00Z',
  completed_at: '2026-01-01T00:00:03Z',
};

const evidence = {
  id: EXEC_ID,
  analysis_id: ANALYSIS_ID,
  audit_id: AUDIT_ID,
  task_id: EXEC_ID,
  artifact_id: null,
  analyzer_version: 'v1',
  scoring_rule_version: 'v1',
  logical_engine: 'gemini',
  transport_provider: 'google',
  transport_model: 'gemini-flash-latest',
  prompt_index: 0,
  repetition: 1,
  prompt_class: 'unbranded',
  cohort: 'core',
  brand_mentioned: true,
  brand_first_offset: 0,
  owned_domain_cited: true,
  owned_citation_count: 1,
  unintended_domain_cited: false,
  citation_count: 1,
  search_used: true,
  search_query_count: 1,
  perception: [],
  claims: [],
  ads: { applicability: 'not_applicable', parser_version: null, items: [] },
  avg_position: null,
  score: { visibility: 1 },
  citations: [
    {
      ordinal: 1,
      url: 'https://acme.example/a',
      title: 'Acme docs',
      domain: 'acme.example',
      classification: 'owned',
      is_owned: true,
      is_unintended: false,
      matched_competitor: null,
    },
  ],
  competitors_mentioned: [],
  created_at: '2026-01-01T00:00:00Z',
};

test('shell → open run → open execution evidence', async ({ page }) => {
  await stubAuthedShell(page);
  await page.route(/\/api\/v1\/audits(\?.*)?$/, (route) => route.fulfill({ json: [audit] }));
  await page.route(`**/api/v1/audits/${AUDIT_ID}`, (route) => route.fulfill({ json: audit }));
  await page.route(`**/api/v1/audits/${AUDIT_ID}/executions`, (route) =>
    route.fulfill({ json: [execution] }),
  );
  await page.route(`**/api/v1/executions/${EXEC_ID}`, (route) => route.fulfill({ json: evidence }));

  await page.goto(fixtureProjectPath('/runs'));

  // Runs list renders and the run links to its detail page.
  await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible();
  await page.getByRole('table').getByRole('link', { name: 'View' }).first().click();

  // Run detail: progress panel + executions table.
  await expect(page).toHaveURL(fixtureProjectPath(`/runs/${AUDIT_ID}`));
  await expect(page.getByText('Executions')).toBeVisible();
  await page.getByRole('button', { name: 'Evidence' }).first().click();

  // Execution evidence stays in the run page's drawer: answer + citation.
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Acme is a leading CRM.')).toBeVisible();
  await expect(drawer.getByText('Acme docs')).toBeVisible();
});
