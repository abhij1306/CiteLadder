import { expect, test, type Page } from '@playwright/test';

import { FIXTURE_PROJECT, fixtureProjectPath, stubAuthedShell } from './helpers/app-fixture';

/**
 * The rendered geometry census: what the browser DRAWS, not what the code
 * asks for.
 *
 * `check:policy` guards the inputs (tokens, classes). It cannot see a 28px
 * button beside a 32px tab, a toolbar rebinding a token, or an error block
 * that is 88px on one route and 152px on the next — and those are what made
 * the app look inconsistent (docs/plans/app-geometry-consistency.md). So this
 * walks every product route at the owner's viewport (982×900, DPR 1) and at
 * 1280×900, in light and dark, measures every visible control, badge, tab,
 * band, box and query state, and asserts ONE value per role — the same
 * literals in every configuration. The expected values are literals on
 * purpose: deriving them from the tokens would let a token edit move the
 * whole app and still pass.
 *
 * The shell fixture answers every unstubbed read with a 404, so most routes
 * settle into their read-error state; Runs is also rendered with fixture
 * rows, so table rows, badges and real cards are measured too, and Settings
 * integrations with a connection, so two neighbouring cards are measured.
 */

const ROUTES = [
  '/projects',
  '/site',
  '/demand',
  '/issues',
  '/search-intelligence',
  '/performance',
  '/products',
  '/prompts',
  '/visibility',
  '/runs',
  '/ai-traffic',
  '/settings',
  '/settings?tab=integrations',
  '/settings?tab=providers',
  '/billing',
  '/agent/actions',
  '/agent/skills',
  '/agent/context',
] as const;

/** One control height for the product. */
const CONTROL_HEIGHT = 32;
/** One badge height. */
const BADGE_HEIGHT = 20;
/** Text controls and tabs share one horizontal padding; icon-only controls have none. */
const TEXT_CONTROL_PADDING_X = 12;
const ICON_CONTROL_PADDING_X = 0;
/** The control band: 8 + a 32px row + 8, closed by a 1px rule. */
const CONTROL_BAND_HEIGHT = 49;
/** Sections in the content region stand 24 apart; cards inside a section 16. */
const SECTION_GAP = 24;
const CARD_GAP = 16;
/** One box recipe: padding 16 on the box element, radius 12, a 1px border. */
const CARD_INSET = 16;
const BOX_RADIUS = 12;
const BOX_BORDER = 1;
/** Loading, read-error and first-use empty share one footprint. */
const QUERY_STATE_HEIGHT = 160;
const TABLE_ROW_HEIGHT = 36;
const TABLE_CELL_PADDING_Y = 6;

type Box = Readonly<{ route: string; role: string; label: string; value: number }>;

/** Everything the census measures on one settled page, as role/value records. */
function measure(route: string) {
  const round = (value: number) => Math.round(value * 2) / 2;
  const visible = (element: Element) => {
    if (element.closest('[hidden]')) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const label = (element: Element) =>
    (element.getAttribute('aria-label') ?? (element as HTMLElement).innerText ?? '')
      .replaceAll(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
  const px = (value: string) => round(Number.parseFloat(value) || 0);
  const records: { route: string; role: string; label: string; value: number }[] = [];
  const add = (role: string, element: Element, value: number) =>
    records.push({ route, role, label: label(element), value: round(value) });
  const all = (selector: string) => Array.from(document.querySelectorAll(selector)).filter(visible);
  const hasText = (element: Element) => ((element as HTMLElement).innerText ?? '').trim() !== '';

  // Controls the user presses. Tabs, segments and in-field affordances are
  // measured as their own roles below; a hint's enlarged hit area (negative
  // margin around a glyph) is a target, not a drawn control.
  for (const element of all('button, a[role="button"]')) {
    if (element.closest('[role="tablist"], [role="radiogroup"], [role="menu"], [role="dialog"]'))
      continue;
    if (element.closest(':has(> input)')) continue;
    const style = getComputedStyle(element);
    if (Number.parseFloat(style.marginTop) < 0) continue;
    if (
      element.getAttribute('role') === 'combobox' ||
      element.getAttribute('aria-haspopup') === 'listbox'
    )
      continue;
    const rect = element.getBoundingClientRect();
    add('button.height', element, rect.height);
    const text = Array.from(element.childNodes).some(
      (node) =>
        (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) ||
        (node instanceof HTMLElement &&
          node.tagName !== 'svg' &&
          hasText(node) &&
          !node.matches('[class*="rounded-full"]')),
    );
    add(text ? 'button.padding-x.text' : 'button.padding-x.icon', element, px(style.paddingLeft));
    add('control.font-size', element, px(style.fontSize));
  }
  // A field's drawn box is the bordered frame around the native input.
  for (const input of all(
    'input:not([type="hidden"], [type="checkbox"], [type="radio"], [type="file"]), textarea',
  )) {
    let box: Element = input;
    for (let node: Element | null = input; node; node = node.parentElement) {
      if (Number.parseFloat(getComputedStyle(node).borderTopWidth) > 0) {
        box = node;
        break;
      }
    }
    if (input.tagName !== 'TEXTAREA')
      add('input.height', input, box.getBoundingClientRect().height);
  }
  for (const element of all('select, [role="combobox"], button[aria-haspopup="listbox"]'))
    add('select.height', element, element.getBoundingClientRect().height);
  for (const element of all('[role="tab"]')) {
    add('tab.height', element, element.getBoundingClientRect().height);
    add('tab.padding-x', element, px(getComputedStyle(element).paddingLeft));
  }
  // A segmented switch is measured by its track: segments sit inside it.
  for (const element of all('[role="radiogroup"], .selection-track'))
    add('segmented.height', element, element.getBoundingClientRect().height);
  for (const element of all('aside a, nav a')) {
    if (element.closest('[role="radiogroup"], [role="tablist"], .selection-track')) continue;
    if (!hasText(element)) continue;
    add('nav-row.height', element, element.getBoundingClientRect().height);
  }
  // Badges: status and count objects in text or cells, never inside a control.
  for (const element of all('.type-badge')) {
    if (element.closest('button, a, [role="radiogroup"], [role="tab"]')) continue;
    const display = getComputedStyle(element).display;
    if (!display.includes('flex')) continue;
    add('badge.height', element, element.getBoundingClientRect().height);
  }
  // The header cluster: every control on the identity band's row, the
  // shell's own glyphs included.
  const identity = document.querySelector('[data-page-band="identity"]');
  if (identity && visible(identity)) {
    const band = identity.getBoundingClientRect();
    for (const element of all('button, a[role="button"]')) {
      const rect = element.getBoundingClientRect();
      if (rect.top >= band.top && rect.bottom <= band.bottom && rect.left >= band.left)
        add('header-cluster.height', element, rect.height);
    }
  }
  for (const element of all('[data-page-band="control"]'))
    add('control-band.height', element, element.getBoundingClientRect().height);
  // Section rhythm: the gap between consecutive sections of the content region.
  for (const region of all('[data-page-measure]')) {
    let previous: Element | undefined;
    for (const child of Array.from(region.children).filter(visible)) {
      if (previous) {
        const above = previous.getBoundingClientRect().bottom;
        add('section.gap', child, child.getBoundingClientRect().top - above);
      }
      previous = child;
    }
  }
  // Boxes (cards and panels): the gap between neighbouring boxes inside a
  // section, and where their content starts — the ink, not the CSS, because
  // the same 16 can sit on the box or on a child.
  const boxes = '.surface-card, .surface-panel';
  const isContent = (element: Element) =>
    element.matches('button, input, select, textarea, svg, img, [role="combobox"]') ||
    Array.from(element.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
  // A state nested in a container shares that container's surface and inset
  // (globals.css), so it is not a box of its own.
  const nestedState = (element: Element) =>
    element.matches('.query-state, .empty-state-surface') &&
    element.parentElement?.closest(`${boxes}, [role="dialog"], .table-frame`) != null;
  for (const box of all(boxes)) {
    if (nestedState(box)) continue;
    const boxStyle = getComputedStyle(box);
    add('box.padding', box, px(boxStyle.paddingTop));
    add('box.radius', box, px(boxStyle.borderTopLeftRadius));
    add('box.border', box, px(boxStyle.borderTopWidth));
    const next = box.nextElementSibling;
    if (
      next?.matches(boxes) &&
      visible(next) &&
      !box.parentElement?.matches('[data-page-measure]')
    ) {
      const a = box.getBoundingClientRect();
      const b = next.getBoundingClientRect();
      if (b.top >= a.bottom) add('card.gap', next, b.top - a.bottom);
      else if (b.left >= a.right) add('card.gap', next, b.left - a.right);
    }
    if (box.querySelector('table')) continue;
    const ink = Array.from(box.querySelectorAll('*'))
      // Visually hidden text (a clipped 1px box) is announced, not drawn.
      .filter(
        (element) =>
          visible(element) &&
          isContent(element) &&
          !element.closest('svg *') &&
          getComputedStyle(element).clipPath === 'none' &&
          getComputedStyle(element).clip !== 'rect(0px, 0px, 0px, 0px)',
      )
      .map((element) => element.getBoundingClientRect());
    if (ink.length === 0) continue;
    // Measured from the inside of the box's one-pixel border.
    const edge = box.getBoundingClientRect();
    const top = edge.top + Number.parseFloat(boxStyle.borderTopWidth);
    const left = edge.left + Number.parseFloat(boxStyle.borderLeftWidth);
    add('card.inset-top', box, Math.min(...ink.map((rect) => rect.top)) - top);
    add('card.inset-left', box, Math.min(...ink.map((rect) => rect.left)) - left);
  }
  for (const element of all('[data-query-state]')) {
    add('query-state.height', element, element.getBoundingClientRect().height);
    if (!nestedState(element))
      add('query-state.padding', element, px(getComputedStyle(element).paddingTop));
  }
  for (const row of all('tbody tr')) {
    add('table-row.height', row, row.getBoundingClientRect().height);
    const cell = row.querySelector('td');
    if (cell) add('table-cell.padding-y', cell, px(getComputedStyle(cell).paddingTop));
  }
  return records;
}

async function census(page: Page, route: string): Promise<Box[]> {
  await page.goto(fixtureProjectPath(route));
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-query-state="loading"]')).toHaveCount(0);
  return page.evaluate(measure, route);
}

/** The distinct values one role rendered, with where each came from. */
function valuesOf(records: readonly Box[], role: string) {
  const values = new Map<number, string[]>();
  for (const record of records.filter((entry) => entry.role === role)) {
    const where = values.get(record.value) ?? [];
    where.push(`${record.route} "${record.label}"`);
    values.set(record.value, where);
  }
  return values;
}

function expectOneValue(records: readonly Box[], role: string, expected: number) {
  const values = valuesOf(records, role);
  const offenders = [...values.entries()]
    .filter(([value]) => value !== expected)
    .map(([value, where]) => `${value}px: ${where.slice(0, 6).join(', ')}`);
  expect.soft(offenders, `${role} renders only ${expected}px`).toEqual([]);
  expect.soft(values.size, `${role} was measured`).toBeGreaterThan(0);
}

const RUNS = [
  { id: '44444444-4444-4444-8444-444444444441', status: 'completed', failed_count: 0 },
  { id: '44444444-4444-4444-8444-444444444442', status: 'failed', failed_count: 3 },
  { id: '44444444-4444-4444-8444-444444444443', status: 'completed', failed_count: 0 },
].map(({ id, status, failed_count }) => ({
  id,
  workspace_id: FIXTURE_PROJECT.workspace_id,
  project_id: FIXTURE_PROJECT.id,
  status,
  benchmark_mode: 'consumer_like',
  repetitions: 3,
  random_seed: '7',
  requested_count: 3,
  completed_count: 3 - failed_count,
  failed_count,
  error_message: '',
  engine_snapshots: [],
  market: { id: null, country_code: 'US', language_code: 'en' },
  launch_id: null,
  not_applicable_engines: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  started_at: '2026-01-01T00:00:05Z',
  completed_at: '2026-01-01T00:10:00Z',
}));

/** A Search Console connection, so Settings draws its two integration cards. */
const CONNECTIONS = [
  {
    id: '55555555-5555-4555-8555-555555555551',
    workspace_id: FIXTURE_PROJECT.workspace_id,
    grant_id: '55555555-5555-4555-8555-555555555552',
    provider: 'gsc',
    label: 'example.com GSC',
    account_ref: 'sc-domain:example.com',
    grant_status: 'connected',
    granted_scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    last_synced_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

/** The owner's viewport and a wide one, each in both themes: the same literals. */
const CONFIGURATIONS = [
  { width: 982, theme: 'light' },
  { width: 982, theme: 'dark' },
  { width: 1280, theme: 'light' },
  { width: 1280, theme: 'dark' },
] as const;

for (const { width, theme } of CONFIGURATIONS) {
  test.describe(`${width}×900 ${theme}`, () => {
    test.use({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: theme });

    test('every product route renders one value per geometric role', async ({ page }) => {
      test.setTimeout(240_000);
      // The product theme is a stored per-device choice, not the OS scheme.
      await page.addInitScript(
        (value) => window.localStorage.setItem('citeladder.theme', value),
        theme,
      );
      await expectOneGeometry(page);
    });
  });
}

async function expectOneGeometry(page: Page) {
  await stubAuthedShell(page);
  const records: Box[] = [];
  for (const route of ROUTES) records.push(...(await census(page, route)));

  // A list route with rows, so tables, badges and real cards are measured.
  await stubAuthedShell(page, [[/\/api\/v1\/audits(\?.*)?$/, RUNS]]);
  const runs = await census(page, '/runs');
  records.push(...runs.map((record) => ({ ...record, route: '/runs (rows)' })));

  // Neighbouring cards, so the card → card gap is measured, not assumed.
  await stubAuthedShell(page, [[/\/api\/v1\/integrations(\?.*)?$/, CONNECTIONS]]);
  const integrations = await census(page, '/settings?tab=integrations');
  records.push(
    ...integrations.map((record) => ({ ...record, route: '/settings integrations (cards)' })),
  );

  expectOneValue(records, 'button.height', CONTROL_HEIGHT);
  expectOneValue(records, 'input.height', CONTROL_HEIGHT);
  expectOneValue(records, 'select.height', CONTROL_HEIGHT);
  expectOneValue(records, 'tab.height', CONTROL_HEIGHT);
  expectOneValue(records, 'segmented.height', CONTROL_HEIGHT);
  expectOneValue(records, 'nav-row.height', CONTROL_HEIGHT);
  expectOneValue(records, 'header-cluster.height', CONTROL_HEIGHT);
  expectOneValue(records, 'control.font-size', 14);
  expectOneValue(records, 'badge.height', BADGE_HEIGHT);
  expectOneValue(records, 'button.padding-x.text', TEXT_CONTROL_PADDING_X);
  expectOneValue(records, 'button.padding-x.icon', ICON_CONTROL_PADDING_X);
  expectOneValue(records, 'tab.padding-x', TEXT_CONTROL_PADDING_X);
  expectOneValue(records, 'control-band.height', CONTROL_BAND_HEIGHT);
  expectOneValue(records, 'section.gap', SECTION_GAP);
  expectOneValue(records, 'card.gap', CARD_GAP);
  expectOneValue(records, 'box.padding', CARD_INSET);
  expectOneValue(records, 'box.radius', BOX_RADIUS);
  expectOneValue(records, 'box.border', BOX_BORDER);
  expectOneValue(records, 'card.inset-top', CARD_INSET);
  expectOneValue(records, 'card.inset-left', CARD_INSET);
  expectOneValue(records, 'query-state.height', QUERY_STATE_HEIGHT);
  expectOneValue(records, 'query-state.padding', CARD_INSET);
  expectOneValue(records, 'table-row.height', TABLE_ROW_HEIGHT);
  expectOneValue(records, 'table-cell.padding-y', TABLE_CELL_PADDING_Y);

  // The account menu is a 32px control like every other one in its row.
  await expect(page.getByRole('button', { name: /^Account menu/ })).toHaveCSS('height', '32px');
}
