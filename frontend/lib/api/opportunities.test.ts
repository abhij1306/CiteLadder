import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { mswServer } from '@/test/msw-server';
import { opportunitiesApi } from './opportunities';
import { queryKeys } from './query-keys';
import {
  opportunitiesPageSchema,
  opportunityDetailSchema,
  opportunitySchema,
} from '@citeladder/contracts/opportunities';
import { strictValidate } from '@citeladder/contracts/validation';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const OPP = '22222222-2222-4222-8222-222222222222';
const AUDIT = '33333333-3333-4333-8333-333333333333';

const item = {
  id: OPP,
  project_id: PROJECT,
  rule_id: 'brand_absent_high_value_prompt',
  opportunity_type: 'visibility' as const,
  severity: 'high' as const,
  priority_score: 120,
  title: 'Brand absent from high-value prompt',
  target_key: `prompt:${OPP}`,
  target_prompt_id: OPP,
  target_url: null,
  target_theme: 'crm',
  target_label: 'best crm for small teams',
  action_id: '66666666-6666-4666-8666-666666666666',
  system_rank: 1,
  display_rank: 1,
  order_source: 'system' as const,
  priority_factors: { severity_weight: 40, evidence_weight: 20 },
  evidence_summary: { count: 2, kinds: ['response_analysis', 'metric_snapshot'] },
  created_at: '2026-07-24T00:00:00Z',
  updated_at: '2026-07-24T00:00:00Z',
};

const detail = {
  ...item,
  remediation: 'Publish a comparison page.',
  evidence: { prompt_text: 'best crm for small teams', competitor_names: ['Globex'] },
  source_analysis_ids: [AUDIT],
  source_issue_ids: [],
  source_metric_ids: [AUDIT],
  source_traffic_ids: [],
  analyzer_version: 'opp-analyzer-1',
  rule_version: 'opp-rules-1',
  formula_version: 'opp-formula-1',
  content_handoff: {
    opportunity_id: OPP,
    pathway: 'owned' as const,
    source_class: null,
    canonical_domain: null,
    suggested_role: 'Content',
    suggested_skill_id: 'comparison',
    target_url: null,
    target_theme: 'crm',
    representative_citations: [],
    affected_themes: ['crm'],
    observed_competitors: ['Globex'],
    coverage: {},
    limitations: [],
    truncated: false,
    source_analysis_ids: [AUDIT],
    snapshot_versions: { analyzer_version: 'opp-analyzer-1' },
  },
  superseded_by_id: null,
  superseded_at: null,
};

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe('opportunity schemas (strictValidate drift policy)', () => {
  it('accepts a valid catalog row', () => {
    expect(strictValidate(opportunitySchema, item, 'test')).toEqual(item);
    expect(strictValidate(opportunityDetailSchema, detail, 'test')).toEqual(detail);
    expect(
      strictValidate(opportunitiesPageSchema, { items: [item], next_cursor: null }, 'test'),
    ).toEqual({ items: [item], next_cursor: null });
  });
});

describe('opportunitiesApi transport', () => {
  it('builds the list query string from params', async () => {
    const seen: string[] = [];
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/opportunities`, ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ items: [item], next_cursor: null });
      }),
    );

    const page = await opportunitiesApi.list(PROJECT, {
      type: 'site',
      severity: 'medium',
      status: 'open',
      rule_id: 'thin_content',
      min_priority: 30,
      limit: 25,
      cursor: 'abc',
    });
    expect(page.items).toHaveLength(1);
    expect(seen).toHaveLength(1);
    const params = new URLSearchParams(seen[0]);
    expect(params.get('type')).toBe('site');
    expect(params.get('severity')).toBe('medium');
    expect(params.get('status')).toBe('open');
    expect(params.get('rule_id')).toBe('thin_content');
    expect(params.get('min_priority')).toBe('30');
    expect(params.get('limit')).toBe('25');
    expect(params.get('cursor')).toBe('abc');
  });

  it('omits undefined params from the query string', async () => {
    const seen: string[] = [];
    mswServer.use(
      http.get(`/api/v1/projects/${PROJECT}/opportunities`, ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );
    await opportunitiesApi.list(PROJECT);
    expect(seen[0]).toBe('');
  });

  it('gets the detail', async () => {
    mswServer.use(http.get(`/api/v1/opportunities/${OPP}`, () => HttpResponse.json(detail)));
    expect((await opportunitiesApi.get(OPP)).rule_id).toBe('brand_absent_high_value_prompt');
  });
});

describe('opportunity query keys', () => {
  it('isolates namespaces by project / id / filters', () => {
    expect(queryKeys.opportunities.all).toEqual(['opportunities']);
    expect(queryKeys.opportunities.list(PROJECT, { severity: 'high' })).toEqual([
      'opportunities',
      'list',
      PROJECT,
      { severity: 'high' },
    ]);
    expect(queryKeys.opportunities.detail(OPP)).toEqual(['opportunities', 'detail', OPP]);
  });
});
