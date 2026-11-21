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
    products_services: [
      'AI Visibility tracking (brand mentions, position, sentiment and competitors across AI answers and search engines)',
      'Analytics',
    ],
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
    href: '/insights',
    opportunity_id: null,
  },
  track: {
    citation_share: { value: 32.5, delta: 2.1 },
    engine_coverage: 2,
    observed_at: evidence.observed_at,
    limitations: [],
  },
  measurement: {
    audit_id: '33333333-3333-4333-8333-333333333333',
    completed_at: evidence.observed_at,
    benchmark_mode: 'consumer_like',
    logical_engines: ['chatgpt', 'claude'],
    comparable_audit_id: null,
    comparison_status: 'no_baseline',
    comparison_answers: null,
    metric_snapshot_id: null,
    analyzer_version: null,
    scoring_rule_version: null,
  },
  state: {
    visibility: { value: 72.5, delta: 4.2 },
    share_of_voice: { value: 48.1, delta: 3.1 },
    brand_rank: { value: 2, delta: -1 },
  },
  movements: [
    { label: 'chatgpt', direction: 'positive', current: 72.5, previous: 68.3, delta: 4.2 },
  ],
  active_prompt_count: 1,
  actions: [],
  action_order_version: 0,
  report_available: false,
  stale: false,
};
const layout = {
  widgets: [
    { key: 'project_state', size: 'full' },
    { key: 'movement', size: 'half' },
    { key: 'next_action', size: 'half' },
    { key: 'missing_prompts', size: 'full' },
    { key: 'ranked_actions', size: 'full' },
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
  for (const width of [1440, 1024, 982, 390]) {
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
        const progress = await page.getByRole('region', { name: 'Setup progress' }).boundingBox();
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
        coverage: { earliest_date: '2026-01-01', latest_date: '2026-01-28', covered_days: 28 },
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
  const tabInto = async () => {
    await field.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(field).toBeFocused();
  };
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await field.evaluate((node) => {
      node.removeAttribute('aria-invalid');
      node.blur();
    });
    const ordinaryEdge = await field.evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
      return getComputedStyle(node).borderColor;
    });
    await tabInto();
    const ordinary = await field.evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
      const style = getComputedStyle(node);
      return { edge: style.borderColor, outline: style.outlineStyle, glow: style.boxShadow };
    });
    expect(ordinary.outline).toBe('none');
    expect(ordinary.glow).not.toBe('none');
    expect(ordinary.edge).not.toBe(ordinaryEdge);
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
    await tabInto();
    const focused = await field.evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
      const style = getComputedStyle(node);
      return {
        edge: style.borderColor,
        outline: style.outlineStyle,
        glow: style.boxShadow,
      };
    });
    expect(focused).toMatchObject({ edge, outline: 'none' });
    expect(focused.glow).not.toBe('none');
    expect(focused.glow).not.toBe(ordinary.glow);
  }
  await page.emulateMedia({ forcedColors: 'active' });
  await field.focus();
  expect(await field.evaluate((node) => getComputedStyle(node).borderStyle)).toBe('solid');
});

test('Agent text entry paints one focus boundary', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stubAuthedShell(page);
  await page.goto(fixtureProjectPath('/agent'));
  const prompt = page.locator('textarea');
  const form = prompt.locator('xpath=ancestor::form');
  const inputEdge = await prompt.evaluate((node) => getComputedStyle(node).borderColor);
  await prompt.click();
  await expect(prompt).toBeFocused();
  // The composer is the box: its frame takes the focus edge and the halo,
  // like any framed field.
  await expect(async () => {
    expect(await form.evaluate((node) => getComputedStyle(node).borderColor)).not.toBe(outerEdge);
  }).toPass();
  expect(await form.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe('none');
  expect(await form.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none');
  // One boundary: the field inside draws no edge, halo or outline of its own.
  expect(await prompt.evaluate((node) => getComputedStyle(node).borderColor)).toBe(inputEdge);
  expect(await prompt.evaluate((node) => getComputedStyle(node).boxShadow)).toBe('none');
  expect(await prompt.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none');
  const room = await form.evaluate((node) => {
    let clip = node.parentElement;
    while (clip && getComputedStyle(clip).overflowX === 'visible') clip = clip.parentElement;
    if (!clip) return Infinity;
    const box = node.getBoundingClientRect();
    const edge = clip.getBoundingClientRect();
    return Math.min(box.left - edge.left, edge.right - box.right, box.top - edge.top);
  });
  expect(room).toBeGreaterThanOrEqual(3);
});
