import { expect, test } from '@playwright/test';
import { FIXTURE_PROJECT, fixtureProjectPath, stubAuthedShell } from './helpers/app-fixture';
import type { SearchIntelligenceDataset } from '../lib/api/search-intelligence';

const id = (value: number) => `33333333-3333-4333-8333-${String(value).padStart(12, '0')}`;
const target = {
  identity: 'primary',
  label: 'Acme Outdoor',
  registrable_domain: 'acme-outdoor.example',
  hostname: 'www.acme-outdoor.example',
  origin: 'https://www.acme-outdoor.example',
  source_kind: 'owned',
};
const competitor = {
  identity: id(20),
  label: 'Summit Gear',
  registrable_domain: 'summit-gear.example',
  hostname: 'summit-gear.example',
  origin: 'https://summit-gear.example',
  source_kind: 'competitor',
};
function dataset(
  value: number,
  kind: string,
  overrides: Partial<SearchIntelligenceDataset> = {},
): SearchIntelligenceDataset {
  return {
    id: id(value),
    run_id: id(10),
    dataset_kind: kind,
    target_domain: target.registrable_domain,
    target_hostname: target.hostname,
    target_origin: target.origin,
    comparison_origin: '',
    location_code: 2840,
    language_code: 'en',
    status: 'published',
    coverage: 'empty',
    requested_rows: 100,
    raw_rows_received: 0,
    unique_rows_saved: 0,
    provider_total: null,
    truncated: false,
    summary: {},
    collection_started_at: null,
    collection_ended_at: null,
    published_at: '2026-09-20T14:07:59Z',
    ...overrides,
    research_scope: overrides.research_scope ?? 'exact_host',
    acquisition: overrides.acquisition ?? {},
  };
}
const datasets = [
  dataset(1, 'footprint', {
    summary: {
      organic_keywords: 4233,
      estimated_monthly_traffic: '8632.703566448763',
      top_10_keywords: 318,
    },
  }),
  dataset(2, 'ranking_keywords', {
    unique_rows_saved: 100,
    provider_total: 4233,
    coverage: 'complete',
  }),
  dataset(3, 'shared_keywords', { comparison_origin: competitor.origin }),
  dataset(4, 'missing_keywords', { comparison_origin: competitor.origin }),
  dataset(5, 'referring_domains', { location_code: null, language_code: '', provider_total: 0 }),
  dataset(6, 'backlink_summary', { location_code: null, language_code: '' }),
  dataset(7, 'organic_pages', {
    research_scope: 'domain_subdomains',
    unique_rows_saved: 1,
    provider_total: 200,
    coverage: 'complete',
  }),
  dataset(8, 'backlinks', {
    research_scope: 'domain_subdomains',
    location_code: null,
    language_code: '',
    unique_rows_saved: 1,
    provider_total: 800,
    coverage: 'complete',
  }),
  dataset(9, 'backlink_history', {
    research_scope: 'domain_subdomains',
    location_code: null,
    language_code: '',
    unique_rows_saved: 2,
    coverage: 'complete',
  }),
  dataset(10, 'backlink_summary', {
    research_scope: 'domain_subdomains',
    location_code: null,
    language_code: '',
    summary: { backlinks: 3000, referring_domains: 400, referring_main_domains: 250, rank: 60 },
  }),
  dataset(11, 'footprint', { location_code: 2036 }),
];
const rows = Array.from({ length: 10 }, (_, index) => ({
  id: id(100 + index),
  dataset_id: id(2),
  call_id: id(30),
  row_kind: 'ranking_keywords',
  keyword: `Family outfits ${index + 1}`,
  domain: '',
  url: `${target.origin}/family-christmas`,
  search_volume: 3600,
  difficulty: 24,
  intent: 'commercial',
  rank_group: 38,
  owned_rank_group: null,
  etv: '7.55999994',
  backlinks: null,
  referring_main_domains: null,
  dataforseo_rank: null,
  auxiliary: {},
}));

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`saved search results remain readable and do not trigger acquisition at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const project = {
      ...FIXTURE_PROJECT,
      name: target.label,
      website_url: target.origin,
      country_code: 'AU',
    };
    const base = `**/api/v1/projects/${project.id}/search-intelligence`;
    await stubAuthedShell(
      page,
      [
        [
          base,
          {
            connected: true,
            connection_id: id(50),
            owned_targets: [target],
            competitors: [competitor],
            preferences: {
              owned_target_id: 'primary',
              competitor_ids: [],
              location_code: 2036,
              language_code: 'en',
              reuse_recent: true,
              depths: {},
            },
            latest_run: null,
            datasets,
          },
        ],
      ],
      [project],
    );
    await page.route(`${base}/datasets/*/rows*`, (route) => {
      const saved = datasets.find((item) => route.request().url().includes(item.id));
      const details = newDatasetRows(saved);
      return route.fulfill({
        json: { dataset: saved, rows: saved?.id === id(2) ? rows : details, next_cursor: null },
      });
    });
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/search-intelligence'))
        writes.push(request.url());
    });
    await page.goto(fixtureProjectPath('/search-intelligence'));
    await expect(page.getByText('8,633', { exact: true })).toBeVisible();
    await expect(page.getByText('United States · en', { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
    await page.getByRole('tab', { name: 'Keywords', exact: true }).click();
    await expect(page.getByRole('cell', { name: '8', exact: true }).first()).toBeVisible();
    await page.getByRole('combobox', { name: 'Saved market' }).click();
    await page.getByRole('option', { name: 'Australia · en' }).click();
    await page.getByRole('combobox', { name: 'Saved scope' }).click();
    await page.getByRole('option', { name: 'Domain + subdomains' }).click();
    await expect(page.getByRole('radio', { name: 'Top pages', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Saved scope' }).click();
    await page.getByRole('option', { name: 'Exact host' }).click();
    await page.getByRole('combobox', { name: 'Saved market' }).click();
    await page.getByRole('option', { name: 'United States · en' }).click();
    await page.getByRole('tab', { name: 'Competitors', exact: true }).click();
    await page.getByRole('button', { name: 'Summit Gear: Keywords you both rank for' }).click();
    await expect(
      page.getByText('The provider returned no data for this saved scope.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'All competitors' }).click();
    await expect(page.getByRole('cell', { name: 'Summit Gear summit-gear.example' })).toBeVisible();
    await page.getByRole('tab', { name: 'Backlinks', exact: true }).click();
    await page.getByRole('radio', { name: 'Referring domains', exact: true }).click();
    await expect(
      page.getByText('The provider returned no data for this saved scope.'),
    ).toBeVisible();
    await page.getByRole('combobox', { name: 'Saved scope' }).click();
    await page.getByRole('option', { name: 'Domain + subdomains' }).click();
    await page.getByRole('radio', { name: 'Backlinks', exact: true }).click();
    await expect(page.getByText('https://publisher.test/story', { exact: true })).toBeVisible();
    await expect(page.getByText('400', { exact: true })).toBeVisible();
    await expect(page.getByText('250', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Saved backlink history' })).toBeVisible();
    await page.getByRole('tab', { name: 'Keywords', exact: true }).click();
    await page.getByRole('radio', { name: 'Top pages', exact: true }).click();
    await expect(page.getByRole('cell', { name: '22', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
    await page.getByRole('button', { name: 'New analysis' }).click();
    await expect(page.getByRole('combobox', { name: 'Market' })).toHaveText('Australia');
    expect(writes).toEqual([]);
  });
}

function newDatasetRows(saved: SearchIntelligenceDataset | undefined) {
  if (!saved) return [];
  const common = { ...rows[0], dataset_id: saved.id, row_kind: saved.dataset_kind };
  if (saved.dataset_kind === 'organic_pages')
    return [{ ...common, url: 'https://shop.acme-outdoor.example/family', organic_keywords: 22 }];
  if (saved.dataset_kind === 'backlinks')
    return [
      {
        ...common,
        url_from: 'https://publisher.test/story',
        anchor: 'Family collection',
        dofollow: true,
        dataforseo_rank: 55,
      },
    ];
  if (saved.dataset_kind === 'backlink_history')
    return [
      {
        ...common,
        id: id(90),
        backlinks: 1000,
        auxiliary: { date: '2026-02-30 00:00:00 +00:00' },
      },
      {
        ...common,
        id: id(91),
        backlinks: 2000,
        auxiliary: { date: '2026-06-30 00:00:00 +00:00', new_backlinks: 200, lost_backlinks: 50 },
      },
      {
        ...common,
        id: id(92),
        backlinks: 3000,
        auxiliary: { date: '2026-08-31 00:00:00 +00:00', new_backlinks: 300, lost_backlinks: 100 },
      },
    ];
  return [];
}
