import { expect, it } from 'vite-plus/test';

import type {
  SearchIntelligenceDataset,
  SearchIntelligenceReadiness,
} from '@/lib/api/search-intelligence';
import { defaultSelections, selectionKey } from './search-intelligence-review-selection';

const target = (identity: string, hostname: string) => ({
  identity,
  label: hostname,
  registrable_domain: hostname.replace(/^www\./u, ''),
  hostname,
  origin: `https://${hostname}`,
  source_kind: identity === 'rival' ? 'competitor' : 'owned',
});

const comparison = (targetOrigin: string): SearchIntelligenceDataset => ({
  id: '11111111-1111-4111-8111-111111111111',
  run_id: '22222222-2222-4222-8222-222222222222',
  dataset_kind: 'missing_keywords',
  target_domain: new URL(targetOrigin).hostname.replace(/^www\./u, ''),
  target_hostname: new URL(targetOrigin).hostname,
  target_origin: targetOrigin,
  research_scope: 'domain_subdomains',
  acquisition: {},
  comparison_origin: 'https://rival.com',
  location_code: 2840,
  language_code: 'en',
  status: 'published',
  coverage: 'complete',
  requested_rows: 100,
  raw_rows_received: 100,
  unique_rows_saved: 100,
  provider_total: 100,
  truncated: false,
  summary: {},
  collection_started_at: null,
  collection_ended_at: '2026-10-08T10:00:00Z',
  published_at: '2026-10-08T10:00:00Z',
});

const readiness = (datasets: SearchIntelligenceDataset[]): SearchIntelligenceReadiness => ({
  connected: true,
  connection_id: '72dbc77c-676f-4bf7-8c29-16f163cb09f5',
  owned_targets: [target('shop', 'www.shop.example'), target('blog', 'blog.example')],
  competitors: [target('rival', 'rival.com')],
  preferences: {
    owned_target_id: 'shop',
    competitor_ids: [],
    location_code: 2840,
    language_code: 'en',
    reuse_recent: true,
    depths: {},
  },
  latest_run: null,
  datasets,
});

it('refreshes a comparison saved for the website under review', () => {
  const keys = defaultSelections(readiness([comparison('https://www.shop.example')]), 'refresh');
  expect(keys.map(selectionKey)).toEqual(['missing_keywords:rival']);
});

it('ignores a comparison saved for another of your websites and starts from the preset', () => {
  const keys = defaultSelections(readiness([comparison('https://blog.example')]), 'refresh');
  expect(keys.map(selectionKey)).toEqual([
    'footprint:',
    'ranking_keywords:',
    'missing_keywords:rival',
    'shared_keywords:rival',
  ]);
});
