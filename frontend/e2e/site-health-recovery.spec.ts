import { expect, test } from '@playwright/test';

import { FIXTURE_PROJECT, fixtureProjectPath, stubAuthedShell } from './helpers/app-fixture';

const PROJECT = FIXTURE_PROJECT.id;

test('Site Health retries only its failed initial read inside the authenticated shell', async ({
  page,
}) => {
  let available = false;
  let dashboardReads = 0;
  let crawlCreates = 0;
  await stubAuthedShell(page);
  await page.route(`**/api/v1/projects/${PROJECT}/site-health`, (route) => {
    dashboardReads += 1;
    return available
      ? route.fulfill({
          json: {
            project_id: PROJECT,
            crawl: null,
            score_summary: null,
            phase: 'empty',
            snapshot_id: null,
            quota: { used: 0, limit: 50 },
            root_errors: [],
          },
        })
      : route.fulfill({
          status: 503,
          json: { error: { message: 'Dashboard temporarily unavailable' } },
        });
  });
  await page.route(`**/api/v1/projects/${PROJECT}/monitored-urls`, (route) =>
    route.fulfill({
      json: {
        project_id: PROJECT,
        selection_version: 1,
        monitored_urls: [],
        quota: { used: 0, limit: 50 },
      },
    }),
  );
  await page.route('**/api/v1/site-crawls', (route) => {
    crawlCreates += 1;
    return route.fulfill({
      status: 500,
      json: { error: { message: 'Unexpected crawl mutation' } },
    });
  });

  await page.goto(fixtureProjectPath('/site'));
  await expect(page.getByText('Dashboard temporarily unavailable')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  const readsBeforeRetry = dashboardReads;

  available = true;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Run your first site crawl')).toBeVisible();
  expect(dashboardReads).toBe(readsBeforeRetry + 1);
  expect(crawlCreates).toBe(0);
});
