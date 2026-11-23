import { createElement, type ReactElement } from 'react';
import type { AffectedPage, SiteIssue } from '@citeladder/contracts';

import { renderWithProviders } from '@/test/render';
import { IssuesCatalog as ScopedIssuesCatalog } from './issues-catalog';

export const CRAWL = '44444444-4444-4444-8444-444444444444';
export const ISSUE_A = 'aaaaaaaa-1111-4111-8111-111111111111';
export const URL_A = 'cccccccc-1111-4111-8111-111111111111';

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export function IssuesCatalog(props: Readonly<{ crawlId: string }>) {
  return createElement(ScopedIssuesCatalog, {
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    ...props,
  });
}

export function renderIssues(
  ui: ReactElement,
  initialLocation = window.location.pathname + window.location.search,
) {
  window.history.replaceState(null, '', initialLocation);
  return renderWithProviders(ui);
}

export function issue(overrides: Partial<SiteIssue> = {}): SiteIssue {
  return {
    group_id: ISSUE_A,
    crawl_id: CRAWL,
    rule_id: 'aeo.website_schema',
    page_kinds: [],
    dimension: 'aeo',
    category: 'schema',
    severity: 'high',
    title: 'WebSite schema is missing',
    description: 'Search engines cannot find WebSite structured data on this page.',
    remediation: 'Add a JSON-LD WebSite schema.',
    remediation_route: 'code',
    score_roles: ['aeo_readiness'],
    affected_url_count: 32,
    new_url_count: null,
    resolved_url_count: null,
    analyzer_version: 'a1',
    rule_version: 'r1',
    created_at: '2026-07-15T00:00:00Z',
    ...overrides,
  };
}

export function occurrence(overrides: Partial<AffectedPage> = {}): AffectedPage {
  return {
    occurrence_id: 'dddddddd-1111-4111-8111-111111111111',
    evaluation_id: 'eeeeeeee-1111-4111-8111-111111111111',
    crawl_id: CRAWL,
    rule_id: 'aeo.website_schema',
    site_url_id: URL_A,
    normalized_url: 'https://acme.com/',
    display_url: 'https://acme.com/',
    title: 'Homepage',
    page_kind: 'article',
    dimension: 'aeo',
    category: 'schema',
    severity: 'high',
    issue_title: 'WebSite schema is missing',
    description: 'Expected WebSite structured data is absent.',
    remediation: 'Add a JSON-LD WebSite schema.',
    reason_code: 'expected_schema_absent',
    evidence: { expected_types: ['WebSite'], found_types: ['Organization'] },
    value: { kind: 'none' },
    analyzer_version: 'a1',
    rule_version: 'r1',
    created_at: '2026-07-15T00:00:00Z',
    ...overrides,
  };
}

export function issueDetail(overrides: Record<string, unknown> = {}) {
  return {
    group_id: ISSUE_A,
    crawl_id: CRAWL,
    rule_id: 'aeo.website_schema',
    dimension: 'aeo',
    category: 'schema',
    severity: 'high',
    title: 'WebSite schema is missing',
    description: 'Search engines cannot find WebSite structured data on this page.',
    remediation: 'Add a JSON-LD WebSite schema.',
    remediation_route: 'code',
    occurrences: [occurrence()],
    occurrence_count: 1,
    affected_url_count: 1,
    analyzer_version: 'a1',
    rule_version: 'r1',
    created_at: '2026-07-15T00:00:00Z',
    next_cursor: null,
    ...overrides,
  };
}

export const summary = {
  issue_count: 47,
  occurrence_count: 94,
  severity_counts: { high: 12, medium: 23, low: 12 },
  dimension_counts: { technical: 30, aeo: 17 },
  affected_url_count: 50,
  monitored_affected_url_count: 38,
  section_counts: { technical: 24, content: 9, aeo: 14 },
};

export function isSummaryRequest(request: Request): boolean {
  return !new URL(request.url).searchParams.has('section');
}
