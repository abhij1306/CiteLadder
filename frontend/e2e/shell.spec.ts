import { expect, test } from '@playwright/test';

import {
  FIXTURE_PROJECT,
  FIXTURE_WORKSPACE_ID,
  fixtureProjectPath,
  stubAuthedShell,
} from './helpers/app-fixture';

test('the first-load indicator keeps pulsing until the workspace answers', async ({ page }) => {
  await stubAuthedShell(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/auth/me', async (route) => {
    await pending;
    await route.fallback();
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(fixtureProjectPath('/projects'));
  const indicator = page
    .locator('[data-skeleton="overview"]')
    .getByRole('status', { name: 'Loading the Overview' });
  try {
    await expect(indicator).toBeVisible();
    const block = page.locator('[data-skeleton="overview"] [data-skeleton-block]').first();
    const shimmer = () =>
      block.evaluate((element) => getComputedStyle(element, '::after').translate);
    const initial = await shimmer();
    await expect.poll(shimmer).not.toBe(initial);
  } finally {
    release();
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
});

test('authenticated shell exposes authorized navigation and search, and navigation loads routes', async ({
  page,
}) => {
  // stubAuthedShell supplies the canonical user/project AND the 404 catch-all
  // that keeps unstubbed downstream queries (audits) off the live backend.
  await stubAuthedShell(page);

  await page.goto(fixtureProjectPath('/visibility'));

  const nav = page.getByRole('navigation', { name: 'Dashboard' });
  await expect(nav.getByRole('link', { name: 'Site health', exact: true })).toBeVisible();

  await expect(page.getByText('Acme').first()).toBeVisible();

  await expect(page.getByRole('heading', { level: 1, name: 'Sources' })).toBeVisible();
  await expect(page.getByRole('button', { name: /search or jump to/i })).toBeVisible();

  await nav.getByRole('link', { name: 'Performance', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/performance');
  await expect(page.getByRole('heading', { level: 1, name: 'Performance' })).toBeVisible();
});

test('runs resolve on their own while the schedules empty state waits for its read', async ({
  page,
}) => {
  await stubAuthedShell(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/audits*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/projects/*/audit-schedules', async (route) => {
    await pending;
    await route.fulfill({ json: [] });
  });
  await page.goto(fixtureProjectPath('/runs'));
  try {
    await expect(page.getByRole('heading', { name: 'No runs yet' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Scheduled audits' })).toBeVisible();
    await expect(page.getByText('No scheduled audits yet.')).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByText('No scheduled audits yet.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No runs yet' })).toBeVisible();
});

test('below 1280px the sidebar keeps every destination named and the palette on the keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 982, height: 900 });
  await stubAuthedShell(page);
  await page.goto(fixtureProjectPath('/projects'));

  const nav = page.getByRole('navigation', { name: 'Dashboard' });
  const performance = nav.getByRole('link', { name: 'Performance', exact: true });
  await expect(performance).toBeVisible();
  await performance.click();
  await page.waitForURL((url) => url.pathname === '/performance');
  await expect(page.getByRole('heading', { level: 1, name: 'Performance' })).toBeVisible();

  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await page.getByRole('button', { name: /search or jump to/i }).click();
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).not.toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).not.toBeVisible();
});

test('the prompt builder scrolls inside its pane and never scrolls the panel', async ({ page }) => {
  const projectApi = `**/api/v1/projects/${FIXTURE_PROJECT.id}`;
  const offerings = Array.from({ length: 40 }, (_, index) => `Offering ${index + 1}`);
  const noSources = {
    description: null,
    positioning: null,
    products_services: null,
    target_audience: null,
  };
  await stubAuthedShell(page, [
    [
      /\/api\/v1\/prompt-sets\?/,
      {
        prompt_sets: [],
        limits: {
          generation_count_max: 50,
          brand_prompts_max: 10,
          brand_generation_calls: 4,
          import_rows_max: 500,
          bulk_prompts_max: 500,
          persona_max_chars: 120,
          run_context_max_chars: 280,
          distribution_personas_max: 8,
          seed_query_ids_max: 200,
          context_list_max_entries: 20,
          audit_repetitions_min: 1,
          audit_repetitions_max: 10,
        },
      },
    ],
    [`${projectApi}/topics`, []],
    [`${projectApi}/seed-queries`, { sources: [] }],
    [`${projectApi}/business-map`, { offerings: [], available_offerings: [] }],
    [
      `${projectApi}/topics/preview`,
      {
        source: 'model',
        topics: [{ name: 'Practice nets', offerings: ['Offering 1'] }],
        overflow: [],
      },
    ],
    [
      `${projectApi}/brand-profile`,
      {
        id: '33333333-3333-4333-8333-333333333333',
        workspace_id: FIXTURE_WORKSPACE_ID,
        project_id: FIXTURE_PROJECT.id,
        brand_id: '44444444-4444-4444-8444-444444444444',
        description: '',
        positioning: '',
        products_services: offerings,
        target_audience: '',
        business_context: { buyer_roles: ['Club coach'], market_scope: 'national' },
        sources: noSources,
        source_artifact_ids: noSources,
        created_at: '2026-11-01T00:00:00Z',
        updated_at: '2026-11-01T00:00:00Z',
      },
    ],
  ]);
  const panelGeometry = () =>
    page.evaluate(() => {
      const panel = document.getElementById('main')!;
      const foot = panel.getBoundingClientRect().bottom;
      const bar = document.querySelector('[data-page-band="action-bar"]')?.getBoundingClientRect();
      return {
        scrollTop: panel.scrollTop,
        overflow: panel.scrollHeight - panel.clientHeight,
        barAtFoot: bar !== undefined && bar.bottom <= foot && bar.bottom > foot - 64,
      };
    });
  const still = { scrollTop: 0, overflow: 0, barAtFoot: true };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fixtureProjectPath('/prompts/build'));
  await expect(page.getByText('Offering 40', { exact: true }).last()).toBeVisible();
  expect(await panelGeometry()).toEqual(still);

  const runContext = page.getByLabel('Anything else for this run');
  await runContext.focus();
  await expect(runContext).toBeFocused();
  expect(await panelGeometry()).toEqual(still);

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Topics' })).toBeVisible();
  expect(await panelGeometry()).toEqual(still);

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(runContext).toBeVisible();
  expect(await panelGeometry()).toEqual(still);
});

test('project lookup failure retries in place and only confirmed empty projects enter onboarding', async ({
  page,
}) => {
  await stubAuthedShell(page, [], []);
  let failed = true;
  await page.route('**/api/v1/projects', (route) =>
    failed
      ? route.fulfill({ status: 403, json: { error: { message: 'Project lookup unavailable' } } })
      : route.fulfill({ json: [] }),
  );
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Projects could not be loaded' })).toBeVisible();
  await expect(page).toHaveURL(/\/projects$/);
  failed = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page).toHaveURL(`/onboarding?workspace=${FIXTURE_WORKSPACE_ID}`);
  await expect(page.getByRole('heading', { name: 'Add your brand' })).toBeVisible();
});
