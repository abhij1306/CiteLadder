import { expect, test, type Page } from '@playwright/test';

import { FIXTURE_PROJECT, fixtureProjectPath, stubAuthedShell } from './helpers/app-fixture';

const PROMPT_SET_ID = '44444444-4444-4444-8444-000000000001';
const PROMPT_SETS = {
  prompt_sets: [
    {
      id: PROMPT_SET_ID,
      project_id: FIXTURE_PROJECT.id,
      name: 'Main',
      kind: 'brand',
      prompt_count: 1,
      prompts: [
        {
          id: '44444444-4444-4444-8444-000000000002',
          prompt_set_id: PROMPT_SET_ID,
          text: 'Best pricing tools for small teams',
          theme: '',
          intent: '',
          cohort: 'core',
          branded: false,
          enabled: true,
          status: 'active',
          origin: 'manual',
        },
      ],
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
    },
  ],
  limits: {
    generation_count_max: 50,
    import_rows_max: 500,
    bulk_prompts_max: 500,
    persona_max_chars: 200,
    run_context_max_chars: 2000,
    distribution_personas_max: 5,
    seed_query_ids_max: 20,
    context_list_max_entries: 20,
    audit_repetitions_min: 1,
    audit_repetitions_max: 5,
  },
};

const SHELL_ROLES = [
  'masthead.bottom',
  'nav-row.height',
  'header-cluster.height',
  'main.padding-x',
  'button.height',
] as const;
const CONTROL_ROLES = [
  'header-cluster.height',
  'button.height',
  'input.height',
  'select.height',
  'segmented.height',
  'data-table-header.height',
] as const;
const STRIP_ROLES = ['page-tab.height', 'tabs-strip.height'] as const;
const SLIP_INSET_ROLES = ['slip.padding', 'slip.inset-top', 'slip.inset-left'] as const;
const NONE_ROLES = [
  'band.gap',
  'tabs-strip.top',
  'button.padding-x.icon',
  'query-state.padding',
  'figure-target.gap',
  'figure-strip.height-spread',
  'table-head.cut',
  'page.overflow-x',
] as const;
const MIN_TARGET_SIZE = 24;

type Box = Readonly<{ route: string; role: string; label: string; value: number }>;

function measure({ route }: { route: string }) {
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

  for (const element of all('button, a[role="button"]')) {
    if (element.getAttribute('role') === 'switch') {
      add('switch.height', element, element.getBoundingClientRect().height);
      continue;
    }
    if (element.closest('[role="tablist"], [role="radiogroup"], [role="menu"], [role="dialog"]'))
      continue;
    if (element.closest(':has(> input)')) continue;
    if (element.matches('[data-sidebar-ident], [data-sidebar-group-toggle]')) continue;
    if (element.getAttribute('role') === 'checkbox' || element.closest('th')) continue;
    if (element.matches('[data-tree-row]')) {
      add('tree-row.height', element, element.getBoundingClientRect().height);
      continue;
    }
    if (element.matches('[data-figure-cell] > button')) {
      const cell = element.parentElement?.getBoundingClientRect().height ?? 0;
      add('figure-target.gap', element, cell - element.getBoundingClientRect().height);
      continue;
    }
    if (element.matches('button:has(> [data-absence])')) {
      add('absence-target.height', element, element.getBoundingClientRect().height);
      continue;
    }
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
  for (const element of all('[data-page-band="tabs"] [role="tablist"]'))
    add('page-tab.height', element, element.getBoundingClientRect().height);
  for (const element of all('[role="tab"]'))
    add('tab.padding-x', element, px(getComputedStyle(element).paddingLeft));
  for (const element of all('[role="tablist"]'))
    add('tab.gap', element, px(getComputedStyle(element).columnGap));
  for (const element of all('[data-segmented-track] > [role="radiogroup"]'))
    add('segment.gap', element, px(getComputedStyle(element).columnGap));
  for (const element of all(
    '[data-segmented-track], [role="radiogroup"]:not([data-segmented-track] *)',
  )) {
    add('segmented.height', element, element.getBoundingClientRect().height);
  }
  for (const element of all('[data-sidebar-ident]'))
    add('sidebar-ident.height', element, element.getBoundingClientRect().height);
  for (const element of all('[data-sidebar-ident-cell], [data-masthead]'))
    add('masthead.bottom', element, element.getBoundingClientRect().bottom);
  for (const element of all('aside a, nav a, [data-sidebar-group-toggle]')) {
    if (element.closest('[role="radiogroup"], [role="tablist"], [data-segmented-track]')) continue;
    if (element.closest('nav[aria-label="Breadcrumb"]')) continue;
    if (!hasText(element)) continue;
    add('nav-row.height', element, element.getBoundingClientRect().height);
  }
  for (const element of all('[data-tag-kind], [data-status-tone]')) {
    if (element.closest('button, a, [role="radiogroup"], [role="tab"]')) continue;
    const display = getComputedStyle(element).display;
    if (!display.includes('flex')) continue;
    add('tag.height', element, element.getBoundingClientRect().height);
  }
  const identity = document.querySelector('[data-masthead]');
  if (identity && visible(identity)) {
    const band = identity.getBoundingClientRect();
    for (const element of all('button, a[role="button"]')) {
      const rect = element.getBoundingClientRect();
      if (rect.top >= band.top && rect.bottom <= band.bottom && rect.left >= band.left)
        add('header-cluster.height', element, rect.height);
    }
  }
  const bandGap = (selector: string, role: string) => {
    for (const band of all(selector)) {
      const next = band.nextElementSibling;
      if (next && visible(next))
        add(role, next, next.getBoundingClientRect().top - band.getBoundingClientRect().bottom);
    }
  };
  bandGap('[data-masthead]', 'band.gap');
  bandGap('[data-page-band="tabs"]', 'band.gap');
  bandGap('[data-page-band="filters"]', 'band.gap');
  for (const body of all('[data-page-body]'))
    add('body.top-gap', body, px(getComputedStyle(body).paddingTop));
  for (const band of all('[data-page-band="tabs"]')) {
    add('tabs-strip.top', band, px(getComputedStyle(band).paddingTop));
    add('tabs-strip.height', band, band.getBoundingClientRect().height);
  }
  for (const band of all('[data-page-band="filters"]')) {
    const style = getComputedStyle(band);
    add('filter-strip.padding-y', band, px(style.paddingTop));
    add('filter-strip.padding-y', band, px(style.paddingBottom));
    add('filter-strip.height', band, band.getBoundingClientRect().height);
  }
  for (const main of all('[data-main-column]')) {
    const style = getComputedStyle(main);
    add('main.padding-x', main, px(style.paddingLeft));
    add('main.padding-x', main, px(style.paddingRight));
  }
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
  const boxes = '.surface-slip';
  const isContent = (element: Element) =>
    element.matches('[data-callout-tone], [data-icon-tile]') ||
    (!element.parentElement?.closest('[data-callout-tone]') &&
      (element.matches('button, input, select, textarea, svg, img, [role="combobox"]') ||
        Array.from(element.childNodes).some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        )));
  const nestedState = (element: Element) =>
    element.matches('[data-state-block]') &&
    element.parentElement?.closest(`${boxes}, [role="dialog"], .table-frame`) != null;
  for (const box of all(boxes)) {
    if (nestedState(box)) continue;
    const boxStyle = getComputedStyle(box);
    add('slip.padding', box, px(boxStyle.paddingTop));
    add('slip.radius', box, px(boxStyle.borderTopLeftRadius));
    const item = box.parentElement;
    const listed = item?.matches('li') && item.childElementCount === 1;
    const next = listed
      ? (item.nextElementSibling?.firstElementChild ?? null)
      : box.nextElementSibling;
    if (
      next?.matches(boxes) &&
      visible(next) &&
      !box.parentElement?.matches('[data-page-content]')
    ) {
      const a = box.getBoundingClientRect();
      const b = next.getBoundingClientRect();
      if (b.top >= a.bottom) add('slip.gap', next, b.top - a.bottom);
      else if (b.left >= a.right) add('slip.gap', next, b.left - a.right);
    }
    if (box.querySelector('table')) continue;
    const ink = Array.from(box.querySelectorAll('*'))
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
    const edge = box.getBoundingClientRect();
    const top = edge.top + Number.parseFloat(boxStyle.borderTopWidth);
    const left = edge.left + Number.parseFloat(boxStyle.borderLeftWidth);
    add('slip.inset-top', box, Math.min(...ink.map((rect) => rect.top)) - top);
    add('slip.inset-left', box, Math.min(...ink.map((rect) => rect.left)) - left);
  }
  for (const element of all('[data-state-block]:not([data-state-block-inline])')) {
    if (!element.matches('[data-state-frame]') && !nestedState(element))
      add('query-state.padding', element, px(getComputedStyle(element).paddingTop));
  }
  for (const element of all('[data-data-table-header]'))
    add('data-table-header.height', element, element.getBoundingClientRect().height);
  for (const element of all('[data-figure-cell]')) {
    add('figure-cell.padding-y', element, px(getComputedStyle(element).paddingTop));
    if (element.matches('[data-label-lines="2"], [data-sub-line]')) continue;
    add('figure-cell.height', element, element.getBoundingClientRect().height);
  }
  for (const row of all('dl[data-figure-strip]')) {
    const heights = Array.from(row.children)
      .filter(visible)
      .map((cell) => cell.getBoundingClientRect().height);
    if (heights.length > 1)
      add('figure-strip.height-spread', row, Math.max(...heights) - Math.min(...heights));
  }
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
  for (const list of all('[data-setting-rows]')) {
    const rows = Array.from(list.children).filter(visible);
    for (const [index, row] of rows.entries()) {
      const style = getComputedStyle(row);
      if (index > 0) add('setting-row.padding-y', row, px(style.paddingTop));
      if (index < rows.length - 1) add('setting-row.padding-y', row, px(style.paddingBottom));
    }
  }
  for (const element of all('[data-field-end-target]')) {
    const rect = element.getBoundingClientRect();
    add('field-end-target.size', element, rect.width);
    add('field-end-target.size', element, rect.height);
    const hit = getComputedStyle(element, '::before');
    add('field-end-target.hit', element, px(hit.width));
    add('field-end-target.hit', element, px(hit.height));
  }
  for (const element of all('[data-code-token]')) {
    const style = getComputedStyle(element);
    add('code-token.padding-x', element, px(style.paddingLeft));
    add('code-token.padding-y', element, px(style.paddingTop));
  }
  for (const row of all('tbody tr:not([data-table-state])')) {
    if (row.querySelector('[data-cell-lines] > :nth-child(2)'))
      add('table-row.height.two-lines', row, row.getBoundingClientRect().height);
    const cell = row.querySelector('td');
    if (cell) add('table-cell.padding-y', cell, px(getComputedStyle(cell).paddingTop));
  }
  for (const head of all('.table-frame thead th')) {
    const drawn = [head, ...head.querySelectorAll('*')].filter(
      (node) => node.clientWidth > 1 && !node.closest('[role="checkbox"]'),
    );
    add(
      'table-head.cut',
      head,
      Math.max(0, ...drawn.map((node) => node.scrollWidth - node.clientWidth)),
    );
  }
  const root = document.documentElement;
  add('page.overflow-x', root, Math.max(0, root.scrollWidth - root.clientWidth));
  return records;
}

const WIDTHS = [982, 1280] as const;

async function census(
  page: Page,
  route: string,
  { label = route, prepare }: { label?: string; prepare?: (page: Page) => Promise<void> } = {},
): Promise<Box[]> {
  await page.setViewportSize({ width: WIDTHS[0], height: 900 });
  await page.goto(fixtureProjectPath(route));
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
  // Unstubbed reads answer 404, so a route that never idles is re-reading a
  // failed read forever: a product bug to fix, never a timeout to raise.
  await page.waitForLoadState('networkidle');
  await prepare?.(page);
  const nextFrame = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
  const records: Box[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await nextFrame();
    await expect(page.locator('[data-state-block="loading"], [data-skeleton]')).toHaveCount(0);
    const route = `${label} @${width}`;
    const settled = await page.evaluate(measure, { route });
    await nextFrame();
    expect.soft(await page.evaluate(measure, { route }), `${route} holds still`).toEqual(settled);
    records.push(...settled);
  }
  return records;
}

function valuesOf(records: readonly Box[], roles: readonly string[]) {
  const values = new Map<number, string[]>();
  for (const record of records.filter((entry) => roles.includes(entry.role))) {
    const where = values.get(record.value) ?? [];
    where.push(`${record.role} ${record.route} "${record.label}"`);
    values.set(record.value, where);
  }
  return values;
}

const describeValues = (values: ReadonlyMap<number, string[]>) =>
  [...values.entries()].map(([value, where]) => `${value}px: ${where.slice(0, 4).join(', ')}`);

function expectOneValue(records: readonly Box[], roles: readonly string[]) {
  const values = valuesOf(records, roles);
  if (values.size > 1)
    expect.soft(describeValues(values), `${roles.join(' = ')} render one value`).toEqual([]);
}

function expectNone(records: readonly Box[], role: string) {
  const values = valuesOf(records, [role]);
  values.delete(0);
  expect.soft(describeValues(values), `${role} is always 0`).toEqual([]);
}

function expectRoleInvariants(records: readonly Box[], required: readonly string[] = []) {
  const measured = new Set(records.map((entry) => entry.role));
  const missing = [...SHELL_ROLES, ...required].filter((role) => !measured.has(role));
  expect.soft(missing, 'every expected role was measured').toEqual([]);
  for (const role of measured) expectOneValue(records, [role]);
  expectOneValue(records, CONTROL_ROLES);
  expectOneValue(records, STRIP_ROLES);
  expectOneValue(records, SLIP_INSET_ROLES);
  expectOneValue(records, ['field-end-target.size', 'field-end-target.hit']);
  for (const role of NONE_ROLES) expectNone(records, role);
  const smallAbsence = [...valuesOf(records, ['absence-target.height']).keys()].filter(
    (value) => value < MIN_TARGET_SIZE,
  );
  expect.soft(smallAbsence, `an absence target is at least ${MIN_TARGET_SIZE}px`).toEqual([]);
  const small = [...valuesOf(records, ['field-end-target.size']).keys()].filter(
    (value) => value < MIN_TARGET_SIZE,
  );
  expect.soft(small, `a field end target is at least ${MIN_TARGET_SIZE}px`).toEqual([]);
}

const PROMPT_METRIC = {
  id: '44444444-4444-4444-8444-000000000003',
  audit_id: '44444444-4444-4444-8444-444444444441',
  prompt_id: '44444444-4444-4444-8444-000000000002',
  prompt_index: 0,
  prompt_text: 'Best pricing tools for small teams',
  cohort: 'core',
  composite_score: null,
  previous_score: null,
  immediate_delta: null,
  rolling_four: [],
  per_engine_scores: {},
  components: {},
  engine_agreement: 1,
  repetition_agreement: 1,
  evidence_coverage: 1,
  trend_confidence: 1,
  decline_confirmed: false,
  analyzer_version: 'v1',
  scoring_rule_version: 'v1',
  created_at: '2026-08-01T00:00:00Z',
  visibility_rate: 0.5,
  owned_citation_rate: 0.25,
  avg_position: null,
  visibility_delta: null,
  mentions: 0,
  brands: [],
};

const RUNS = [
  { id: '44444444-4444-4444-8444-444444444441', status: 'completed', failed_count: 0 },
  { id: '44444444-4444-4444-8444-444444444442', status: 'failed', failed_count: 3 },
  { id: '44444444-4444-4444-8444-444444444443', status: 'completed', failed_count: 0 },
].map(({ id, status, failed_count }) => ({
  id,
  workspace_id: FIXTURE_PROJECT.workspace_id,
  project_id: FIXTURE_PROJECT.id,
  status,
  cancelable: false,
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

type PageState = Readonly<{
  route: string;
  label?: string;
  stubs?: Parameters<typeof stubAuthedShell>[1];
  required?: readonly string[];
  prepare?: (page: Page) => Promise<void>;
}>;

const [run] = RUNS;

const ROUTE_GROUPS: Readonly<Record<string, readonly PageState[]>> = {
  projects: [
    { route: '/projects' },
    {
      route: '/projects',
      label: '/projects (account menu)',
      prepare: async (current) => {
        await current.getByRole('button', { name: /^Account menu/ }).click();
        await expect(
          current.getByRole('button', { name: /^Switch to (?:light|dark) theme$/ }),
        ).toBeVisible();
        await current
          .getByRole('menu')
          .evaluate((menu) => Promise.all(menu.getAnimations().map((motion) => motion.finished)));
      },
    },
  ],
  'site health and search': [
    { route: '/site' },
    { route: '/issues' },
    { route: '/search-intelligence' },
    { route: '/performance' },
    { route: '/products' },
  ],
  visibility: [
    { route: '/prompts' },
    { route: '/visibility' },
    {
      route: '/prompts',
      label: '/prompts (searched)',
      stubs: [['**/api/v1/prompt-sets?*', PROMPT_SETS]],
      required: ['field-end-target.size'],
      prepare: async (current) => {
        await current.getByRole('searchbox').first().fill('pricing');
        await expect(current.getByRole('button', { name: 'Clear search' })).toBeVisible();
      },
    },
    {
      route: '/prompts',
      label: '/prompts (measured)',
      stubs: [
        ['**/api/v1/prompt-sets?*', PROMPT_SETS],
        [/\/visibility\/prompts(\?.*)?$/, [PROMPT_METRIC]],
      ],
    },
  ],
  runs: [
    { route: '/runs' },
    {
      route: '/runs',
      label: '/runs (rows)',
      stubs: [[/\/api\/v1\/audits(\?.*)?$/, RUNS]],
      required: ['table-cell.padding-y', 'tag.height'],
    },
    {
      route: `/runs/${run?.id}`,
      label: '/runs/:id (detail)',
      stubs: [
        [new RegExp(String.raw`/api/v1/audits/${run?.id}$`), run],
        [new RegExp(String.raw`/api/v1/audits/${run?.id}/executions(\?.*)?$`), []],
      ],
      required: ['figure-cell.padding-y', 'figure-strip.height-spread'],
    },
  ],
  'ai traffic': [
    { route: '/ai-traffic' },
    { route: '/ai-traffic?tab=crawlers' },
    { route: '/ai-traffic?tab=activity' },
    { route: '/ai-traffic?tab=pages' },
  ],
  settings: [
    { route: '/settings' },
    { route: '/settings?tab=integrations' },
    { route: '/settings?tab=providers' },
    { route: '/settings?tab=connections' },
    {
      route: '/settings?tab=integrations',
      label: '/settings integrations (connected)',
      stubs: [[/\/api\/v1\/integrations(\?.*)?$/, CONNECTIONS]],
    },
  ],
  agent: [
    { route: '/actions' },
    { route: '/agent/skills' },
    { route: '/agent/context' },
    {
      route: '/agent/context?tab=competitors',
      label: '/agent/context (edit panel)',
      required: ['switch.height'],
      prepare: async (current) => {
        await current.getByRole('button', { name: 'Edit competitors' }).click();
        await current.locator('summary', { hasText: 'Mention rule' }).first().click();
        await expect(current.getByRole('switch').first()).toBeVisible();
      },
    },
  ],
};

test.use({ deviceScaleFactor: 1, colorScheme: 'light' });

for (const [group, states] of Object.entries(ROUTE_GROUPS)) {
  test.describe(`geometry: ${group}`, () => {
    for (const { route, label = route, stubs, required, prepare } of states) {
      test(`${label} keeps its role invariants`, async ({ page }) => {
        await stubAuthedShell(page, stubs);
        expectRoleInvariants(await census(page, route, { label, prepare }), required);
      });
    }
  });
}
