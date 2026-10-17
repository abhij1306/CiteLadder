import { expect, test } from '@playwright/test';

import { FIXTURE_WORKSPACE_ID, fixtureProjectPath, stubAuthedShell } from './helpers/app-fixture';

test('the first-load indicator keeps rotating until the workspace answers', async ({ page }) => {
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
  const indicator = page.getByRole('status', { name: 'Loading your workspace…' });
  try {
    await expect(indicator).toBeVisible();
    const initial = await indicator.evaluate((element) => getComputedStyle(element).transform);
    await expect
      .poll(() => indicator.evaluate((element) => getComputedStyle(element).transform))
      .not.toBe(initial);
  } finally {
    release();
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
});

/** Authenticated shell navigation and persistent launcher workflows. */
test('authenticated shell exposes authorized navigation and search', async ({ page }) => {
  // stubAuthedShell supplies the canonical user/project AND the 404 catch-all
  // that keeps unstubbed downstream queries (audits) off the live backend.
  await stubAuthedShell(page);

  await page.goto(fixtureProjectPath('/visibility'));

  // The station list and its destinations are pinned against NAV_GROUPS in
  // components/layout/sidebar-nav.test.tsx. What that render cannot show is
  // that the authed layout actually mounts the nav landmark around the page.
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link', { name: 'Website', exact: true })).toBeVisible();

  // Project switcher shows the active brand.
  await expect(page.getByText('Acme').first()).toBeVisible();

  await expect(page.getByRole('heading', { level: 1, name: 'AI Visibility' })).toBeVisible();
  await expect(page.getByRole('button', { name: /search or jump to/i })).toBeVisible();
});

test('primary navigation loads the destination route', async ({ page }) => {
  await stubAuthedShell(page);
  await page.goto(fixtureProjectPath('/projects'));
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Performance', exact: true })
    .click();
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
    // The runs list owns its first paint: an empty read is shown as soon as it
    // settles. The schedules card must not pre-announce emptiness while its
    // read is still in flight — that state belongs to the settled answer.
    await expect(page.getByRole('heading', { name: 'No runs yet' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Scheduled audits' })).toBeVisible();
    await expect(page.getByText('No scheduled audits yet.')).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByText('No scheduled audits yet.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No runs yet' })).toBeVisible();
});

test('compact navigation hands focus to the command palette and returns it on Escape', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubAuthedShell(page);
  await page.goto(fixtureProjectPath('/projects'));
  const menu = page.getByRole('button', { name: 'Open navigation' });

  await menu.click();
  const navigation = page.getByRole('dialog', { name: 'Navigation', exact: true });
  await navigation.getByRole('button', { name: 'Search or jump to', exact: true }).click();
  await expect(navigation).not.toBeVisible();
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).not.toBeVisible();
  await expect(menu).toBeFocused();
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
  // The workspace resolved; it is the PROJECT list that 403'd, and the notice
  // says so rather than sending the reader after an access problem that is
  // not there.
  await expect(page.getByRole('heading', { name: 'Projects could not be loaded' })).toBeVisible();
  await expect(page).toHaveURL(/\/projects$/);
  failed = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  // The redirect carries the workspace the project will be created in — the
  // one the fixture put the reader in — so a refresh of the creation route
  // cannot silently re-target it.
  await expect(page).toHaveURL(`/onboarding?workspace=${FIXTURE_WORKSPACE_ID}`);
  await expect(page.getByRole('heading', { name: "Let's get started" })).toBeVisible();
});
