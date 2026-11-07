import { expect, test, type Page } from '@playwright/test';

import { FIXTURE_PROJECT, fixtureProjectPath, stubAuthedShell } from './helpers/app-fixture';

/**
 * The rendered geometry census: what the browser DRAWS, not what the code
 * asks for.
 *
 * `check:policy` guards the inputs (tokens, classes). It cannot see a 28px
 * button beside a 32px tab, a toolbar rebinding a token, or an error block
 * that is 88px on one route and 152px on the next — and those are what made
 * the app look inconsistent (docs/design.md, Behaviour every surface keeps). So this
 * walks every product route at the owner's viewport (982×900, DPR 1) and at
 * 1280×900 (light: dark rebinds only colours and shadows), measures every visible control, badge, tab,
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
  '/settings?tab=connections',
  '/agent/actions',
  '/agent/skills',
  '/agent/context',
] as const;

/** One control height for the product: control-md, 32 in the app (decision D11). */
const CONTROL_HEIGHT = 32;
/** One badge height. */
const BADGE_HEIGHT = 22;
/** Text controls and tabs share one horizontal padding; icon-only controls have none. */
const TEXT_CONTROL_PADDING_X = 12;
const ICON_CONTROL_PADDING_X = 0;
/**
 * The sidebar's project and account buttons: as tall as the PageHeader's
 * title row (row-app, 40) in the full column and in the 57px rail,
 * so the sidebar and the page share their first line (decision D11).
 */
const SIDEBAR_IDENT_HEIGHT_FULL = 40;
const SIDEBAR_IDENT_HEIGHT_RAIL = 40;
/**
 * The sticky top bar: the switcher cell and the PageHeader are one 56px bar
 * from the top of the window, the 40 title row with 8 above and below (D12).
 */
const TOP_BAR_HEIGHT = 56;
/** The rail stacks the Dashboard | Agent track: one control wide. */
const RAIL_MODE_TRACK_WIDTH = 32;
/** The shell's breakpoint (`shell:`): the full sidebar from here, the rail below. */
const SHELL_MIN_WIDTH = 1280;
/** The page template: header → 16 → controls → 8 → content; 16 with no controls (D11). */
const HEADER_BAND_GAP = 16;
const CONTROL_BAND_GAP = 8;
/** The content band's children (cards, sections) stand 12 apart, as do cards inside them. */
const CONTENT_GAP = 12;
const CARD_GAP = 12;
/**
 * One box recipe: padding 16 on the box element (D11), radius 8 (rounded-lg,
 * D10), and no border: a box is lifted by its shadow.
 */
const CARD_INSET = 16;
const BOX_RADIUS = 8;
const BOX_BORDER = 0;
/**
 * Loading, read-error and first-use empty share one footprint: the block
 * EmptyState's. The state draws no box of its own (its Skeleton, Callout or
 * EmptyState does), so it has no padding.
 */
const QUERY_STATE_HEIGHT = 200;
const QUERY_STATE_PADDING = 0;
const TABLE_ROW_HEIGHT = 40;
const TABLE_CELL_PADDING_Y = 8;
/** A DataTable's title-and-toolbar row is one control high; the card's 16 insets it. */
const DATA_TABLE_HEADER_HEIGHT = 32;
/**
 * A StatRow segment is padded 12 above and below (cancelled by its margin, so
 * a pressable segment's fill has room); a row's segments share one height.
 */
const STAT_SEGMENT_PADDING_Y = 12;
const STAT_ROW_HEIGHT_SPREAD = 0;
/** The Icon atom's one glyph size. */
const ICON_SIZE = 16;
/** A row's kind mark (an IconTile) is a control-sized square. */
const ICON_TILE_SIZE = 32;
/** A ControlRow and an IdentityRow hold their parts 8 apart (compact-gap). */
const ROW_PART_GAP = 8;
/** A ruled fact list pads each fact 8 above and below. */
const FACT_ROW_PADDING_Y = 8;
/** A field's end target (clear, reveal) is a 24px square, WCAG 2.5.8's minimum (D38). */
const FIELD_END_TARGET_SIZE = 24;
/** An inline code token is padded 8 across and 4 down. */
const CODE_TOKEN_PADDING_X = 8;
const CODE_TOKEN_PADDING_Y = 4;

type Box = Readonly<{ route: string; role: string; label: string; value: number }>;

/** Everything the census measures on one settled page, as role/value records. */
function measure({ route, shellMinWidth }: { route: string; shellMinWidth: number }) {
  const rail = window.innerWidth < shellMinWidth;
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
    // The sidebar's project and account rows are their own role below.
    if (element.matches('[data-sidebar-ident]')) continue;
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
  // Tabs and segmented switches are measured by their track: the tabs and
  // segments sit inside it.
  for (const element of all('[role="tablist"]'))
    add('tab.height', element, element.getBoundingClientRect().height);
  for (const element of all('[role="tab"]'))
    add('tab.padding-x', element, px(getComputedStyle(element).paddingLeft));
  for (const element of all(
    '[data-segmented-track], [role="radiogroup"]:not([data-segmented-track] *)',
  )) {
    // In the icon rail the Dashboard | Agent track stands on end: one control wide.
    if (rail && element.closest('aside'))
      add('rail-mode-track.width', element, element.getBoundingClientRect().width);
    else add('segmented.height', element, element.getBoundingClientRect().height);
  }
  for (const element of all('[data-sidebar-ident]'))
    add(
      rail ? 'sidebar-ident.height.rail' : 'sidebar-ident.height.full',
      element,
      element.getBoundingClientRect().height,
    );
  // The sticky top bar (D12): the sidebar's switcher cell and the PageHeader
  // end on one line, the rule under both, scrolled or not.
  for (const element of all('[data-top-bar], [data-page-header]'))
    add('top-bar.bottom', element, element.getBoundingClientRect().bottom);
  for (const element of all('aside a, nav a')) {
    if (element.closest('[role="radiogroup"], [role="tablist"], [data-segmented-track]')) continue;
    if (!hasText(element)) continue;
    add('nav-row.height', element, element.getBoundingClientRect().height);
  }
  // Badges: status and count objects in text or cells, never inside a control.
  for (const element of all('[data-badge-tone]')) {
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
  // Band rhythm: from each band to whatever band follows it.
  const bandGap = (selector: string, role: string) => {
    for (const band of all(selector)) {
      const next = band.nextElementSibling;
      if (next && visible(next))
        add(role, next, next.getBoundingClientRect().top - band.getBoundingClientRect().bottom);
    }
  };
  bandGap('[data-page-band="identity"]', 'band.gap.header');
  bandGap('[data-page-band="control"]', 'band.gap.controls');
  // Content rhythm: the gap between consecutive children of the content band.
  for (const region of all('[data-page-content]')) {
    let previous: Element | undefined;
    for (const child of Array.from(region.children).filter(visible)) {
      if (previous) {
        const above = previous.getBoundingClientRect().bottom;
        add('content.gap', child, child.getBoundingClientRect().top - above);
      }
      previous = child;
    }
  }
  // Boxes (cards and panels): the gap between neighbouring boxes inside a
  // section, and where their content starts — the ink, not the CSS, because
  // the same 16 can sit on the box or on a child.
  const boxes = '.surface-card, .surface-panel';
  // A Callout is a drawn box of its own: its edge is the ink, not its text.
  const isContent = (element: Element) =>
    element.matches('[data-callout-tone]') ||
    (!element.parentElement?.closest('[data-callout-tone]') &&
      (element.matches('button, input, select, textarea, svg, img, [role="combobox"]') ||
        Array.from(element.childNodes).some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        )));
  // A state nested in a container shares that container's surface and inset
  // (globals.css), so it is not a box of its own.
  const nestedState = (element: Element) =>
    element.matches('.query-state') &&
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
      !box.parentElement?.matches('[data-page-content]')
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
  for (const element of all('[data-query-state]:not([data-query-state-inline])')) {
    add('query-state.height', element, element.getBoundingClientRect().height);
    if (!nestedState(element))
      add('query-state.padding', element, px(getComputedStyle(element).paddingTop));
  }
  // A DataTable's title-and-toolbar row, whatever it holds.
  for (const element of all('[data-data-table-header]'))
    add('data-table-header.height', element, element.getBoundingClientRect().height);
  // A StatRow: every segment's padding, and the segments of one row at one
  // height (the spread between the tallest and the shortest).
  for (const element of all('[data-stat-segment]'))
    add('stat-segment.padding-y', element, px(getComputedStyle(element).paddingTop));
  for (const row of all('dl[data-stat-row]')) {
    const heights = Array.from(row.children)
      .filter(visible)
      .map((segment) => segment.getBoundingClientRect().height);
    if (heights.length > 1)
      add('stat-row.height-spread', row, Math.max(...heights) - Math.min(...heights));
  }
  // The Icon atom: one glyph size beside any text, in both axes.
  for (const element of all('svg[data-icon]')) {
    const rect = element.getBoundingClientRect();
    add('icon.size', element, rect.width);
    add('icon.size', element, rect.height);
  }
  for (const element of all('[data-icon-tile]')) {
    const rect = element.getBoundingClientRect();
    add('icon-tile.size', element, rect.width);
    add('icon-tile.size', element, rect.height);
  }
  // A ControlRow's and an IdentityRow's parts: the drawn space between the
  // leading mark and the text, and (ControlRow) the gap the row keeps open
  // between the text and its controls.
  for (const row of all('[data-control-row], [data-identity-row]')) {
    const [lead] = Array.from(row.children).filter(visible);
    const parts = lead ? Array.from(lead.children).filter(visible) : [];
    const [media, text] = parts;
    if (media && text && parts.length === 2)
      add(
        'row-part.gap',
        row,
        text.getBoundingClientRect().left - media.getBoundingClientRect().right,
      );
    add('row-part.gap', row, px(getComputedStyle(row).columnGap));
  }
  // A ruled fact list: each rule has 8 on both sides — below every fact but
  // the last, above every fact but the first (the list's ends sit flush).
  for (const list of all('[data-fact-list="ruled"]')) {
    const facts = Array.from(list.children).filter(visible);
    for (const [index, fact] of facts.entries()) {
      const style = getComputedStyle(fact);
      if (index > 0) add('fact-row.padding-y', fact, px(style.paddingTop));
      if (index < facts.length - 1) add('fact-row.padding-y', fact, px(style.paddingBottom));
    }
  }
  // A field's end target, in both axes.
  for (const element of all('[data-field-end-target]')) {
    const rect = element.getBoundingClientRect();
    add('field-end-target.size', element, rect.width);
    add('field-end-target.size', element, rect.height);
  }
  for (const element of all('[data-code-token]')) {
    const style = getComputedStyle(element);
    add('code-token.padding-x', element, px(style.paddingLeft));
    add('code-token.padding-y', element, px(style.paddingTop));
  }
  // Rows only: a DataTable's state row holds a QueryState, measured above.
  for (const row of all('tbody tr:not([data-table-state])')) {
    add('table-row.height', row, row.getBoundingClientRect().height);
    const cell = row.querySelector('td');
    if (cell) add('table-cell.padding-y', cell, px(getComputedStyle(cell).paddingTop));
  }
  return records;
}

/**
 * The owner's viewport and a wide one. Each settled page is loaded at the
 * first and measured at both: a reader resizing the window is shown the same
 * page, and one load per page state keeps the census affordable.
 */
const WIDTHS = [982, 1280] as const;

async function census(
  page: Page,
  route: string,
  { label = route, prepare }: { label?: string; prepare?: (page: Page) => Promise<void> } = {},
): Promise<Box[]> {
  await page.setViewportSize({ width: WIDTHS[0], height: 900 });
  await page.goto(fixtureProjectPath(route));
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
  await page.waitForLoadState('networkidle');
  await prepare?.(page);
  const records: Box[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    // A resize re-renders whatever listens for it; measure the next painted frame.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expect(page.locator('[data-query-state="loading"]')).toHaveCount(0);
    records.push(
      ...(await page.evaluate(measure, {
        route: `${label} @${width}`,
        shellMinWidth: SHELL_MIN_WIDTH,
      })),
    );
  }
  return records;
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

/** A profile with business details, so Context's Business map draws its ruled fact list. */
const NO_SOURCES = {
  description: null,
  positioning: null,
  products_services: null,
  target_audience: null,
};
const BRAND_PROFILE = {
  id: '66666666-6666-4666-8666-666666666661',
  workspace_id: FIXTURE_PROJECT.workspace_id,
  project_id: FIXTURE_PROJECT.id,
  brand_id: '66666666-6666-4666-8666-666666666662',
  description: 'Analytics for growth teams.',
  positioning: '',
  products_services: [],
  target_audience: '',
  business_context: {
    buyer_roles: ['Head of growth'],
    category_terms: ['product analytics'],
    jobs_to_be_done: ['Find where signups drop'],
  },
  sources: NO_SOURCES,
  source_artifact_ids: NO_SOURCES,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

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

// One theme, at both widths (WIDTHS). The dark theme rebinds colour and
// shadow tokens only (globals.css), neither of which moves a box, so a
// second pass in it measured the same geometry again.
test.describe('light theme', () => {
  test.use({ deviceScaleFactor: 1, colorScheme: 'light' });

  test('every product route renders one value per geometric role', async ({ page }) => {
    test.setTimeout(240_000);
    // With no stored choice the theme follows the emulated device scheme.
    await expectOneGeometry(page);
  });
});

async function expectOneGeometry(page: Page) {
  await stubAuthedShell(page);
  const records: Box[] = [];
  for (const route of ROUTES) records.push(...(await census(page, route)));

  // A list route with rows, so tables, badges and real cards are measured.
  await stubAuthedShell(page, [[/\/api\/v1\/audits(\?.*)?$/, RUNS]]);
  records.push(...(await census(page, '/runs', { label: '/runs (rows)' })));

  // One run's detail, so a StatRow (the run's progress figures) is measured.
  const [run] = RUNS;
  if (!run) throw new Error('the runs fixture has a first run');
  await stubAuthedShell(page, [
    [new RegExp(String.raw`/api/v1/audits/${run.id}$`), run],
    [new RegExp(String.raw`/api/v1/audits/${run.id}/executions(\?.*)?$`), []],
  ]);
  records.push(...(await census(page, `/runs/${run.id}`, { label: '/runs/:id (detail)' })));

  // Neighbouring cards, so the card → card gap is measured, not assumed.
  await stubAuthedShell(page, [[/\/api\/v1\/integrations(\?.*)?$/, CONNECTIONS]]);
  records.push(
    ...(await census(page, '/settings?tab=integrations', {
      label: '/settings integrations (cards)',
    })),
  );

  // Context's Business map, so a ruled fact list (Business details) is measured.
  await stubAuthedShell(page, [
    [`**/api/v1/projects/${FIXTURE_PROJECT.id}/brand-profile`, BRAND_PROFILE],
    [
      `**/api/v1/projects/${FIXTURE_PROJECT.id}/business-map`,
      { available_offerings: [], offerings: [] },
    ],
  ]);
  records.push(
    ...(await census(page, '/agent/context?tab=map', { label: '/agent/context (business map)' })),
  );

  // A search holding a value, so its end target (Clear search) is drawn.
  await stubAuthedShell(page);
  records.push(
    ...(await census(page, '/prompts', {
      label: '/prompts (searched)',
      prepare: async (current) => {
        await current.getByRole('searchbox').first().fill('pricing');
        await expect(current.getByRole('button', { name: 'Clear search' })).toBeVisible();
      },
    })),
  );

  // The account menu open, so its ThemeSwitch (the one control-sm atom) is drawn.
  records.push(
    ...(await census(page, '/projects', {
      label: '/projects (account menu)',
      prepare: async (current) => {
        await current.getByRole('button', { name: /^Account menu/ }).click();
        await expect(
          current.getByRole('button', { name: /^Switch to (?:light|dark) theme$/ }),
        ).toBeVisible();
      },
    })),
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
  expectOneValue(records, 'sidebar-ident.height.full', SIDEBAR_IDENT_HEIGHT_FULL);
  expectOneValue(records, 'sidebar-ident.height.rail', SIDEBAR_IDENT_HEIGHT_RAIL);
  expectOneValue(records, 'rail-mode-track.width', RAIL_MODE_TRACK_WIDTH);
  expectOneValue(records, 'top-bar.bottom', TOP_BAR_HEIGHT);
  expectOneValue(records, 'band.gap.header', HEADER_BAND_GAP);
  expectOneValue(records, 'band.gap.controls', CONTROL_BAND_GAP);
  expectOneValue(records, 'content.gap', CONTENT_GAP);
  expectOneValue(records, 'card.gap', CARD_GAP);
  expectOneValue(records, 'box.padding', CARD_INSET);
  expectOneValue(records, 'box.radius', BOX_RADIUS);
  expectOneValue(records, 'box.border', BOX_BORDER);
  expectOneValue(records, 'card.inset-top', CARD_INSET);
  expectOneValue(records, 'card.inset-left', CARD_INSET);
  expectOneValue(records, 'query-state.height', QUERY_STATE_HEIGHT);
  expectOneValue(records, 'query-state.padding', QUERY_STATE_PADDING);
  expectOneValue(records, 'table-row.height', TABLE_ROW_HEIGHT);
  expectOneValue(records, 'table-cell.padding-y', TABLE_CELL_PADDING_Y);
  expectOneValue(records, 'data-table-header.height', DATA_TABLE_HEADER_HEIGHT);
  expectOneValue(records, 'stat-segment.padding-y', STAT_SEGMENT_PADDING_Y);
  expectOneValue(records, 'stat-row.height-spread', STAT_ROW_HEIGHT_SPREAD);
  expectOneValue(records, 'icon.size', ICON_SIZE);
  expectOneValue(records, 'icon-tile.size', ICON_TILE_SIZE);
  expectOneValue(records, 'row-part.gap', ROW_PART_GAP);
  expectOneValue(records, 'fact-row.padding-y', FACT_ROW_PADDING_Y);
  expectOneValue(records, 'field-end-target.size', FIELD_END_TARGET_SIZE);
  expectOneValue(records, 'code-token.padding-x', CODE_TOKEN_PADDING_X);
  expectOneValue(records, 'code-token.padding-y', CODE_TOKEN_PADDING_Y);
}
