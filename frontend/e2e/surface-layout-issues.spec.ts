import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

import { makeSiteCrawl } from '../test/fixtures/site-health';
import { FIXTURE_PROJECT, fixtureProjectPath, stubAuthedShell } from './helpers/app-fixture';
import { bandBox, type Box } from './helpers/band-box';

const CRAWL = '44444444-4444-4444-8444-444444444444';
const PAGE_SIZE = 25;

const summary = {
  issue_count: 42,
  defect_issue_type_count: 42,
  advisory_issue_type_count: 2,
  occurrence_count: 120,
  severity_counts: { high: 4, medium: 20, low: 18 },
  dimension_counts: { technical: 30, aeo: 12 },
  affected_url_count: 1240,
  monitored_affected_url_count: 38,
  section_counts: { technical: 30, content: 9, aeo: 3 },
};

function rowsFor(params: URLSearchParams): number {
  if (params.get('finding_class') === 'advisory') return 2;
  if (params.get('severity')) return 4;
  if (params.get('page_kind')) return 6;
  if (params.get('section') === 'content') return 9;
  if (params.get('section') === 'aeo') return 3;
  return 30;
}

function issue(index: number, params: URLSearchParams) {
  const id = String(index + 1).padStart(12, '0');
  return {
    group_id: `00000000-0000-4000-8000-${id}`,
    crawl_id: CRAWL,
    rule_id: `rule.${index}`,
    page_kinds: [],
    dimension: params.get('section') === 'aeo' ? 'aeo' : 'technical',
    category: 'schema',
    severity: ['high', 'medium', 'low'][index % 3],
    finding_class: params.get('finding_class') ?? 'defect',
    title: `${params.get('section') ?? 'top'} issue ${index + 1}${index % 4 === 0 ? ' where the structured data names a different organisation than the page footer' : ''}`,
    description: 'What this check looks for.',
    remediation: 'Fix it.',
    remediation_route: 'code',
    affected_url_count: index % 2 === 0 ? 1200 - index : 3,
    analyzer_version: 'a1',
    rule_version: 'r1',
    created_at: '2026-07-15T00:00:00Z',
  };
}

function issuesPage(route: Route) {
  const params = new URL(route.request().url()).searchParams;
  const total = params.has('section') ? rowsFor(params) : 3;
  const start = params.get('cursor') === 'page-2' ? PAGE_SIZE : 0;
  const count = Math.min(PAGE_SIZE, total - start);
  const narrowed = params.has('severity') || params.has('page_kind');
  return route.fulfill({
    json: {
      items: Array.from({ length: count }, (_, index) => issue(start + index, params)),
      next_cursor: start + count < total ? 'page-2' : null,
      summary:
        narrowed || params.get('finding_class') === 'advisory'
          ? {
              ...summary,
              defect_issue_type_count: 4,
              severity_counts: { high: narrowed ? 1 : 0, medium: 2, low: 1 },
              affected_url_count: 9,
              section_counts: { technical: 4, content: 1, aeo: 0 },
            }
          : summary,
    },
  });
}

async function stubIssues(page: Page) {
  await stubAuthedShell(page, [
    [
      `**/api/v1/projects/${FIXTURE_PROJECT.id}/site-health`,
      {
        project_id: FIXTURE_PROJECT.id,
        crawl: makeSiteCrawl({
          id: CRAWL,
          workspace_id: FIXTURE_PROJECT.workspace_id,
          project_id: FIXTURE_PROJECT.id,
        }),
        score_summary: null,
        phase: 'dashboard',
        snapshot_id: null,
        quota: { used: 3, limit: 50 },
        root_errors: [],
      },
    ],
    [`**/api/v1/site-crawls/${CRAWL}/issue-fixes`, { crawl_id: CRAWL, items: [] }],
  ]);
  await page.route(new RegExp(`/api/v1/site-crawls/${CRAWL}/issues(\\?|$)`), issuesPage);
}

async function layout(page: Page, table: Locator): Promise<Record<string, Box>> {
  const parts: Record<string, Locator> = {
    masthead: page.locator('[data-masthead]'),
    tabs: page.getByRole('radiogroup', { name: 'Issue type' }),
    filters: table.locator('[data-filter-bar]'),
    search: page.getByRole('searchbox', { name: 'Search issues' }),
    summary: page.getByRole('region', { name: 'Fix these first' }),
    head: table.locator('thead'),
    firstRow: table.locator('tbody tr').first(),
  };
  const boxes: Record<string, Box> = {};
  for (const [name, part] of Object.entries(parts))
    boxes[name] = (await part.count()) === 1 ? await bandBox(part) : null;
  boxes.search = boxes.search?.slice(1) ?? null;
  return boxes;
}

function moved(before: Box, after: Box): boolean {
  if (!before || !after) return before !== after;
  return before.some((value, index) => Math.abs(value - (after[index] ?? Infinity)) > 1);
}

const print = (box: Box) => (box ? box.map(Math.round).join(',') : 'absent');

for (const width of [1280, 1600])
  test(`no click on the Issues page moves the bands above its rows at ${width}px`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 900 });
    await stubIssues(page);
    await page.goto(fixtureProjectPath('/issues'));
    const table = page.getByRole('region', { name: 'Issues', exact: true });
    const rows = table.locator('tbody tr');
    await expect(rows.first()).toContainText('technical issue 1');
    await page.evaluate(() => document.fonts.ready);
    const settled = async () => {
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(table).not.toHaveAttribute('aria-busy', 'true');
      return layout(page, table);
    };
    const before = await settled();
    const [, tabsY = 0, , tabsHeight = 0] = before.tabs ?? [];
    const [searchY = 0, , searchHeight = 0] = before.search ?? [];
    expect(Math.abs(tabsY + tabsHeight / 2 - (searchY + searchHeight / 2))).toBeLessThanOrEqual(1);
    expect(before.filters?.[3] ?? Infinity).toBeLessThan(Math.max(tabsHeight, searchHeight) + 8);
    const shifts: string[] = [];
    const check = async (step: string) => {
      const after = await settled();
      for (const [name, box] of Object.entries(before)) {
        const next = after[name] ?? null;
        if (moved(box, next)) shifts.push(`${step}: ${name} ${print(box)} -> ${print(next)}`);
      }
    };
    const openFilter = async (filter: RegExp) => {
      await table
        .locator('[data-filter-bar]')
        .getByRole('button', { name: /^Filters/ })
        .click();
      await page.getByRole('menuitem', { name: filter }).click();
    };
    const choose = async (filter: RegExp, option: string) => {
      await openFilter(filter);
      await page.getByRole('menuitemradio', { name: option }).click();
    };

    await page.getByRole('radio', { name: /^Content/ }).click();
    await expect(rows.first()).toContainText('content issue 1');
    await check('Content tab');
    await page.getByRole('radio', { name: /^AEO/ }).click();
    await expect(rows.first()).toContainText('aeo issue 1');
    await check('AEO tab');
    await page.getByRole('radio', { name: /^Technical/ }).click();
    await expect(rows.first()).toContainText('technical issue 1');
    await check('Technical tab');

    await choose(/^Severity/, 'Advisory');
    await expect(rows.nth(1)).toContainText('technical issue 2');
    await expect.poll(() => new URL(page.url()).searchParams.get('severity')).toBe('advisory');
    await check('Severity advisory');
    await choose(/^Severity/, 'All severities');
    await expect(rows.nth(24)).toContainText('technical issue 25');
    await expect(table.getByText('technical issue 26')).toHaveCount(0);
    await expect(table.getByRole('button', { name: 'Next page' })).toBeEnabled();
    await check('Severity all after advisory');

    await choose(/^Severity/, 'High');
    await expect.poll(() => new URL(page.url()).searchParams.get('severity')).toBe('high');
    await check('Severity high');
    await choose(/^Severity/, 'All severities');
    await expect(table.getByRole('button', { name: 'Next page' })).toBeEnabled();
    await check('Severity all');

    await openFilter(/^Page kind/);
    await page.getByRole('menuitemradio').nth(1).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('page_kind')).not.toBeNull();
    await check('Page kind');
    await choose(/^Page kind/, 'All page kinds');
    await expect(table.getByRole('button', { name: 'Next page' })).toBeEnabled();
    await check('Page kind all');

    const heads = table.locator('thead');
    await heads.getByRole('button', { name: /^Pages affected/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('sort')).toBe('pages');
    await check('Sort by pages');
    await heads.getByRole('button', { name: /^Severity/ }).click();
    await check('Sort by severity');

    await table.getByRole('button', { name: 'Next page' }).click();
    await expect(rows.first()).toContainText('technical issue 26');
    await check('Next page');
    await table.getByRole('button', { name: 'Previous page' }).click();
    await expect(rows.first()).toContainText('technical issue 1');
    await check('Previous page');

    await rows.first().getByRole('button').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await check('Open and close an issue');

    expect(shifts).toEqual([]);
  });

test('at phone width the search takes a line and the other controls share the next', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await stubIssues(page);
  await page.goto(fixtureProjectPath('/issues'));
  const table = page.getByRole('region', { name: 'Issues', exact: true });
  await expect(table.locator('tbody tr').first()).toContainText('technical issue 1');
  const bar = table.locator('[data-filter-bar]');
  const filters = bar.getByRole('button', { name: /^Filters/ });
  await filters.click();
  await page.getByRole('menuitem', { name: /^Severity/ }).click();
  await page.getByRole('menuitemradio', { name: 'High' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  const clear = bar.getByRole('button', { name: 'Clear' });
  await expect(clear).toBeVisible();
  const box = async (part: Locator) => (await part.boundingBox())!;
  const [search, filtersBox, clearBox, barBox] = await Promise.all([
    box(page.getByRole('searchbox', { name: 'Search issues' })),
    box(filters),
    box(clear),
    box(bar),
  ]);
  expect(search.width).toBeGreaterThan(barBox.width / 2);
  expect(filtersBox.y).toBeGreaterThanOrEqual(search.y + search.height);
  expect(Math.abs(filtersBox.y - clearBox.y)).toBeLessThanOrEqual(1);
  expect(clearBox.x).toBeGreaterThan(filtersBox.x + filtersBox.width);
});
