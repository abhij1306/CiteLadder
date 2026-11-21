import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

import { FIXTURE_PROJECT, fixtureProjectPath, stubAuthedShell } from './helpers/app-fixture';
import { bandBox, type Box } from './helpers/band-box';

const BASE = `**/api/v1/projects/${FIXTURE_PROJECT.id}/actions`;

function action(index: number, grouping: string) {
  const id = String(index + 1).padStart(12, '0');
  return {
    id: `00000000-0000-4000-8000-${id}`,
    project_id: FIXTURE_PROJECT.id,
    target_kind: 'issue_family',
    target_label: `${grouping} fix ${index + 1}${index % 3 === 0 ? ' where the structured data names a different organisation than the page footer' : ''}`,
    target_url: null,
    target_prompt_id: null,
    origin: 'evidence',
    status: 'open',
    measurement: null,
    priority_score: 90 - index,
    priority_band: ['high', 'medium', 'low'][index % 3],
    families: ['site_health'],
    approach: 'fix_technical',
    goal: 'read_site',
    grouping,
    skill_id: 'site_fix',
    member_count: 1,
    declarable_member_count: 1,
    page_count: index % 4 === 0 ? 0 : 1200 - index,
    handoff: { context: 'action', message: 'Fix it.' },
    evidence_cleared_at: null,
    created_at: '2026-11-14T00:00:00Z',
    updated_at: '2026-11-14T00:00:00Z',
  };
}

const accepted = new Set<string>();
const aeo = () =>
  Array.from({ length: 23 }, (_, index) => action(index, 'aeo')).filter(
    (item) => !accepted.has(item.id),
  );
const seo = Array.from({ length: 3 }, (_, index) => action(40 + index, 'seo'));

function grouping(name: string, items: ReturnType<typeof action>[]) {
  return {
    grouping: name,
    count: items.length,
    items: items.slice(0, 10),
    next_cursor: items.length > 10 ? 'next-10' : null,
  };
}

function tree(route: Route) {
  const params = new URL(route.request().url()).searchParams;
  const groupBy = params.get('group_by') ?? 'goal';
  const open = params.get('status') === 'open';
  const rows = open ? aeo() : aeo().slice(0, 2);
  const groupings = [grouping('aeo', rows), grouping('seo', seo)];
  const total = rows.length + seo.length;
  return route.fulfill({
    json: {
      group_by: groupBy,
      status_counts: {
        open: aeo().length + 3,
        in_progress: 9 + accepted.size,
        done: 120,
        dismissed: 8,
      },
      goals: [
        { goal: 'read_site', count: 35, blocking: true },
        { goal: 'own_pages', count: 0, blocking: false },
        { goal: 'mentions', count: 0, blocking: false },
        { goal: 'wrong_claims', count: 0, blocking: false },
      ],
      groups:
        groupBy === 'goal'
          ? [{ key: 'read_site', count: total, groupings }]
          : [{ key: 'high', count: total, groupings }],
    },
  });
}

async function stubActions(page: Page) {
  await stubAuthedShell(page);
  await page.route(`${BASE}/tree?*`, tree);
  await page.route(`${BASE}?*`, (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    const rest = aeo().slice(cursor === 'next-10' ? 10 : 20);
    return route.fulfill({
      json: {
        items: rest.slice(0, 10),
        next_cursor: rest.length > 10 ? 'next-20' : null,
        status_counts: {},
      },
    });
  });
  await page.route(`${BASE}/status`, async (route) => {
    const body = (await route.request().postDataJSON()) as { ids?: string[] };
    for (const id of body.ids ?? []) accepted.add(id);
    return route.fulfill({
      json: { updated: body.ids?.length ?? 0, skipped: 0, truncated: false },
    });
  });
}

async function layout(page: Page): Promise<Record<string, Box>> {
  const parts: Record<string, Locator> = {
    masthead: page.locator('[data-masthead]'),
    toolbar: page.locator('[data-filter-bar]'),
    goals: page.getByRole('group', { name: 'Goals' }),
    firstGroup: page.locator('[data-tree-group]').first(),
  };
  const boxes: Record<string, Box> = {};
  for (const [name, part] of Object.entries(parts))
    boxes[name] = (await part.count()) >= 1 ? await bandBox(part.first()) : null;
  return boxes;
}

function moved(before: Box, after: Box): boolean {
  if (!before || !after) return before !== after;
  return before.some((value, index) => Math.abs(value - (after[index] ?? Infinity)) > 1);
}

const print = (box: Box) => (box ? box.map(Math.round).join(',') : 'absent');

for (const width of [1280, 1600])
  test(`no click on the Actions page moves the toolbar, goal strip or first goal at ${width}px`, async ({
    page,
  }) => {
    accepted.clear();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 900 });
    await stubActions(page);
    await page.goto(fixtureProjectPath('/actions'));
    const aeoRows = page.getByRole('table', { name: /^\d+ actions$/ }).first();
    await expect(aeoRows.getByRole('row')).toHaveCount(11);
    await page.evaluate(() => document.fonts.ready);
    const settled = async () => {
      await expect(page.getByRole('menu')).toHaveCount(0);
      return layout(page);
    };
    const before = await settled();
    const shifts: string[] = [];
    const check = async (step: string) => {
      const after = await settled();
      for (const [name, box] of Object.entries(before)) {
        const next = after[name] ?? null;
        if (moved(box, next)) shifts.push(`${step}: ${name} ${print(box)} -> ${print(next)}`);
      }
    };
    const choose = async (trigger: RegExp, option: string) => {
      await page.locator('[data-filter-bar]').getByRole('button', { name: trigger }).click();
      await page.getByRole('menuitemradio', { name: option }).click();
    };
    const toggle = (name: RegExp) => page.getByRole('button', { name }).first().click();

    await choose(/^Status/, 'New');
    await expect(page.getByRole('button', { name: /^Done, / })).toHaveCount(0);
    await check('Status New');
    await choose(/^Status/, 'All statuses');
    await expect(page.getByRole('button', { name: /^Done, / })).toBeVisible();
    await check('Status all');

    await choose(/^Group by/, 'Impact');
    await expect(page.getByRole('button', { name: /^High impact, / })).toBeVisible();
    await check('Group by impact');
    await choose(/^Group by/, 'Goal');
    await expect(page.getByRole('button', { name: /^Let AI read your site, / })).toBeVisible();
    await check('Group by goal');

    await toggle(/^AEO, /);
    await expect(page.getByRole('table')).toHaveCount(0);
    await check('Close a grouping');
    await toggle(/^AEO, /);
    await expect(aeoRows.getByRole('row')).toHaveCount(11);
    await check('Open a grouping');
    await toggle(/^SEO, /);
    await check('Open a second grouping');
    await toggle(/^Let AI read your site, /);
    await check('Close a goal');
    await toggle(/^Let AI read your site, /);
    await check('Open a goal');
    await toggle(/^In progress, /);
    await check('Open a status');
    await toggle(/^In progress, /);
    await check('Close a status');

    await page.getByRole('button', { name: 'Show 10 more' }).click();
    await expect(aeoRows.getByRole('row')).toHaveCount(21);
    await check('Show more');

    await aeoRows.getByRole('checkbox').first().click();
    const bar = page.getByRole('toolbar', { name: 'Selected actions' });
    await expect(bar).toBeVisible();
    await check('Tick a row');
    await bar.getByRole('button', { name: 'Accept' }).click();
    await expect(bar).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^AEO, 22/ })).toBeVisible();
    await check('Accept a row');

    expect(shifts).toEqual([]);
  });

const hitArea = (control: Locator) =>
  control.evaluate((element) => {
    const area = getComputedStyle(element, '::before');
    return [Number.parseFloat(area.width), Number.parseFloat(area.height)];
  });

test('at 390px an Action title keeps 180px, a goal keeps its title and count whole, and a tick taps at 44', async ({
  page,
}) => {
  accepted.clear();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await stubActions(page);
  await page.goto(fixtureProjectPath('/actions'));
  const aeoRows = page.getByRole('table', { name: /^\d+ actions$/ }).first();
  await expect(aeoRows.getByRole('row')).toHaveCount(11);
  await page.evaluate(() => document.fonts.ready);

  const titles = await aeoRows
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().width));
  expect(Math.min(...titles)).toBeGreaterThanOrEqual(180);

  const goal = page.getByRole('group', { name: 'Goals' }).locator('[data-figure-cell]').first();
  const title = goal.getByText('Let AI read your site', { exact: true });
  const titleBox = await title.boundingBox();
  const markBox = await goal.getByText('Blocking').boundingBox();
  if (!titleBox || !markBox) throw new Error('the first goal draws its title and Blocking tag');
  expect(titleBox.height).toBeLessThanOrEqual(40);
  expect(markBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
  const count = goal.locator('[data-figure-value] span span').first();
  await expect(count).toHaveText('35 ');
  const cut = await count.evaluate((element) => {
    const cell = element.closest('[data-figure-cell]')!.getBoundingClientRect();
    return element.getBoundingClientRect().right > cell.right;
  });
  expect(cut).toBe(false);

  const tick = aeoRows.getByRole('checkbox').first();
  expect(await hitArea(tick)).toEqual([44, 44]);
  expect((await tick.boundingBox())?.width).toBe(16);
});

test.describe('under a coarse pointer at 1280px', () => {
  test.use({ hasTouch: true });

  test('a tick keeps its 16px box and taps at 44', async ({ page }) => {
    accepted.clear();
    await page.setViewportSize({ width: 1280, height: 900 });
    await stubActions(page);
    await page.goto(fixtureProjectPath('/actions'));
    const tick = page
      .getByRole('table', { name: /^\d+ actions$/ })
      .first()
      .getByRole('checkbox')
      .first();
    await expect(tick).toBeVisible();
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    expect(await hitArea(tick)).toEqual([44, 44]);
    expect((await tick.boundingBox())?.width).toBe(16);
  });
});

const GROUP = action(0, 'aeo');
const pageUrl = (index: number) => ({
  site_url_id: `55555555-5555-4555-8555-${String(index + 1).padStart(12, '0')}`,
  url: `https://acme.test/Categories/Babywear/Baby-Bodysuits/BB0${index}_OFF_WHITE`,
  page_kind: index === 0 ? 'homepage' : 'product',
  open_action_count: (index % 4) + 1,
});

async function stubActionPage(page: Page) {
  await stubAuthedShell(page);
  let status = 'open';
  const detail = () => ({
    ...GROUP,
    page_count: 12,
    status,
    summary: null,
    member_measurement: {},
    declarable_since: '2026-01-01T00:00:00Z',
    diagnosis: {},
    members: [],
    declaration: null,
    editable_page: false,
    cohort: null,
    urls: {
      whole_site: false,
      total: 12,
      items: Array.from({ length: 10 }, (_, index) => pageUrl(index)),
      next_cursor: 'after-ten',
    },
  });
  await page.route(`**/api/v1/actions/${GROUP.id}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      status = ((await route.request().postDataJSON()) as { status: string }).status;
      return route.fulfill({ json: { ...GROUP, page_count: 12, status, summary: null } });
    }
    return route.fulfill({ json: detail() });
  });
  await page.route(`**/api/v1/actions/${GROUP.id}/urls?*`, (route) =>
    route.fulfill({
      json: { whole_site: false, total: 12, items: [pageUrl(10), pageUrl(11)], next_cursor: null },
    }),
  );
}

for (const width of [1280, 1600])
  test(`no decision, Show more or tick on an Action page moves its header, Details or dock at ${width}px`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 900 });
    await stubActionPage(page);
    await page.goto(fixtureProjectPath(`/actions/${GROUP.id}`));
    const urls = page.getByRole('list', { name: 'URLs' });
    await expect(urls.getByRole('listitem')).toHaveCount(10);
    await page.evaluate(() => document.fonts.ready);
    const dock = page.getByRole('toolbar', { name: 'Work on this action' });
    const parts: Record<string, Locator> = {
      masthead: page.locator('[data-masthead]'),
      heading: page.getByRole('heading', { level: 1 }),
      details: page.getByRole('region', { name: 'Details' }),
      dock,
    };
    const boxes = async () => {
      const out: Record<string, Box> = {};
      for (const [name, part] of Object.entries(parts)) out[name] = await bandBox(part);
      return out;
    };
    const before = await boxes();
    const shifts: string[] = [];
    const check = async (step: string) => {
      const after = await boxes();
      for (const [name, box] of Object.entries(before))
        if (moved(box, after[name] ?? null))
          shifts.push(`${step}: ${name} ${print(box)} -> ${print(after[name] ?? null)}`);
    };

    await dock.getByRole('button', { name: 'Accept' }).click();
    await expect(dock.getByRole('button', { name: 'Mark implemented' })).toBeVisible();
    await check('Accept');
    await dock.getByRole('button', { name: 'Decline' }).click();
    await expect(dock.getByRole('button', { name: 'Restore' })).toBeVisible();
    await check('Decline');
    await page.getByRole('button', { name: 'Show 2 more' }).click();
    await expect(urls.getByRole('listitem')).toHaveCount(12);
    await check('Show more');
    await urls.getByRole('checkbox').first().click();
    await expect(dock.getByRole('link', { name: 'Fix 1 selected with Agent' })).toBeVisible();
    await check('Tick a URL');

    expect(shifts).toEqual([]);
  });
