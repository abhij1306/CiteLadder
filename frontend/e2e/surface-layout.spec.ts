import { expect, test } from '@playwright/test';

import { FIXTURE_PROJECT, fixtureProjectPath, stubAuthedShell } from './helpers/app-fixture';

const evidence = {
  state: 'observed',
  observed_at: '2026-09-26T10:00:00Z',
  freshness: 'current',
  coverage: ['gsc'],
  limitations: [],
};
const overview = {
  project: FIXTURE_PROJECT,
  facts: {
    industry: 'Software',
    description: 'Analytics for growth teams',
    positioning: 'Evidence-led analytics',
    products_services: ['Analytics'],
    target_audience: 'Growth teams',
    competitors: [],
  },
  loop: {
    connected: evidence,
    analyzed: evidence,
    acted: { ...evidence, state: 'not_run', observed_at: null, coverage: [], freshness: 'unknown' },
    tracked: evidence,
  },
  next_action: {
    kind: 'monitor',
    title: 'No open Action — watch the trend',
    href: '/visibility?tab=trends',
    opportunity_id: null,
  },
  track: {
    citation_share: { value: 32.5, delta: 2.1 },
    engine_coverage: 2,
    observed_at: evidence.observed_at,
    limitations: [],
  },
  measurement: null,
  state: {
    visibility: { value: 72.5, delta: 4.2 },
    share_of_voice: { value: 48.1, delta: 3.1 },
    brand_rank: { value: 2, delta: -1 },
  },
  movements: [
    { label: 'visibility', direction: 'positive', current: 72.5, previous: 68.3, delta: 4.2 },
  ],
  active_prompt_count: 1,
  actions: [],
  action_order_version: 0,
  resolved_actions: { since_audit_id: null, count: 0, titles: [] },
  report_available: false,
  stale: false,
};
// The default layout, so Overview lays out today's sections.
const layout = {
  widgets: [
    { key: 'project_state', size: 'half' },
    { key: 'citation_share', size: 'half' },
    { key: 'movement', size: 'half' },
    { key: 'next_action', size: 'half' },
    { key: 'missing_prompts', size: 'full' },
    { key: 'ranked_actions', size: 'half' },
    { key: 'progress_proof', size: 'half' },
    { key: 'company_facts', size: 'full' },
  ],
  version: 0,
  customized: false,
  updated_at: null,
};
const catalog = {
  maximum_competitors: 5,
  industries: ['General'],
  subindustries: { General: [] },
};

test('working surfaces preserve their actions without viewport overflow', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ['/projects', '/onboarding', '/agent']) {
      await stubAuthedShell(
        page,
        [
          [`**/api/v1/projects/${FIXTURE_PROJECT.id}/command-center`, overview],
          [`**/api/v1/projects/${FIXTURE_PROJECT.id}/overview/layout`, layout],
          ['**/api/v1/brand-discovery-catalog', catalog],
        ],
        route === '/onboarding' ? [] : [FIXTURE_PROJECT],
      );
      await page.goto(route === '/onboarding' ? route : fixtureProjectPath(route));
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('main')).toBeVisible();
      if (route === '/projects')
        await expect(page.getByText('No open Action — watch the trend')).toBeVisible();
      if (route === '/onboarding') {
        await expect(page.getByLabel(/^Brand name/)).toBeVisible();
        const logo = await page.getByRole('link', { name: 'CiteLadder home' }).boundingBox();
        const progress = await page
          .getByRole('navigation', { name: 'Setup progress' })
          .boundingBox();
        expect(
          logo &&
            progress &&
            (logo.x + logo.width <= progress.x || logo.y + logo.height <= progress.y),
        ).toBeTruthy();
      }
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${route} at ${width}px must fit the viewport`,
      ).toBe(true);
    }
  }
});

test('long segments stay on one row and keyboard focus reveals the selected option', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubAuthedShell(page, [
    [
      `**/api/v1/projects/${FIXTURE_PROJECT.id}/performance?*`,
      {
        project_id: FIXTURE_PROJECT.id,
        range: 'last_synced',
        granularity: 'day',
        compare: 'none',
        selected: {
          snapshot_id: null,
          window_start: '',
          window_end: '',
          evidence_state: 'not_run',
          totals: {
            clicks: null,
            impressions: null,
            ctr: null,
            position: null,
            sessions: null,
            key_events: null,
          },
          series: { clicks: [], impressions: [], ctr: [], position: [] },
        },
        comparison: null,
        coverage: { earliest_date: null, latest_date: null, covered_days: 0 },
        dimension_counts: {
          query: 0,
          page: 0,
          country: 0,
          device: 0,
          search_appearance: 0,
          day: 0,
          bing_query: 0,
          bing_page: 0,
        },
        unavailable_dimensions: ['search_appearance'],
        formula_version: 'traffic-formula-1',
        normalization_version: 'traffic-normalization-1',
      },
    ],
  ]);
  await page.goto(fixtureProjectPath('/performance'));
  const options = page.getByRole('radiogroup', { name: 'Date range' }).getByRole('radio');
  await expect(options).toHaveCount(3);
  // Stress the existing control with longer labels without changing product copy.
  await options.evaluateAll((nodes) =>
    nodes.forEach((node) => {
      node.firstChild!.textContent += ' reporting interval';
    }),
  );
  await options.first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(options.last()).toBeFocused();
  await expect(options.last()).toHaveAttribute('aria-checked', 'true');
  const geometry = await options.last().evaluate((node) => {
    const track = node.parentElement!.parentElement!;
    const option = node.getBoundingClientRect();
    const rail = track.getBoundingClientRect();
    return {
      visible: option.left >= rail.left && option.right <= rail.right,
      scrolled: track.scrollLeft > 0,
    };
  });
  expect(geometry).toEqual({ visible: true, scrolled: true });
  const tops = await options.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().top),
  );
  expect(new Set(tops).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('invalid field edges survive keyboard focus in both themes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stubAuthedShell(page, [['**/api/v1/brand-discovery-catalog', catalog]], []);
  await page.goto('/onboarding');
  const field = page.getByLabel(/^Brand name/);
  await expect(field).toBeVisible();
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: /Switch to dark theme/ }).click();
    await field.evaluate((node) => {
      node.removeAttribute('aria-invalid');
      node.blur();
    });
    const ordinaryEdge = await field.evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
      return getComputedStyle(node).borderColor;
    });
    // Isolate the primitive's rendering contract from form validation policy.
    await field.evaluate((node) => {
      node.setAttribute('aria-invalid', 'true');
      node.blur();
    });
    const edge = await field.evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
      return getComputedStyle(node).borderColor;
    });
    expect(edge).not.toBe(ordinaryEdge);
    expect(await field.evaluate((node) => getComputedStyle(node).borderStyle)).not.toBe('none');
    await field.focus();
    const focused = await field.evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
      return {
        edge: getComputedStyle(node).borderColor,
        outline: getComputedStyle(node).outlineStyle,
      };
    });
    expect(focused.edge).toBe(edge);
    expect(focused.outline).toBe('none');
  }
  await page.emulateMedia({ forcedColors: 'active' });
  await field.focus();
  expect(await field.evaluate((node) => getComputedStyle(node).borderStyle)).toBe('solid');
  expect(await field.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none');
});

test('Agent text entry paints one focus boundary', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stubAuthedShell(page);
  await page.goto(fixtureProjectPath('/agent'));
  const prompt = page.locator('textarea');
  const form = prompt.locator('xpath=ancestor::form');
  const outerEdge = await form.evaluate((node) => getComputedStyle(node).borderColor);
  const inputEdge = await prompt.evaluate((node) => getComputedStyle(node).borderColor);
  await prompt.click();
  await expect(prompt).toBeFocused();
  await expect(async () => {
    expect(await prompt.evaluate((node) => getComputedStyle(node).borderColor)).not.toBe(inputEdge);
  }).toPass();
  expect(await form.evaluate((node) => getComputedStyle(node).borderColor)).toBe(outerEdge);
  expect(await form.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none');
  expect(await prompt.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none');
});
