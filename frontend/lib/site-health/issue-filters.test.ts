import { describe, expect, it } from 'vite-plus/test';

import {
  emptyIssueFilters,
  issueFilterParams,
  issueSeverityChange,
  issueSeverityChoice,
  toIssueParams,
} from './issue-filters';

describe('toIssueParams', () => {
  it('maps filters + cursor to request params, dropping empties', () => {
    expect(toIssueParams({ ...emptyIssueFilters, severity: 'low' }, 'C', 50)).toEqual({
      cursor: 'C',
      limit: 50,
      section: 'technical',
      sort: 'severity',
      query: undefined,
      severity: 'low',
      category: undefined,
      rule: undefined,
      site_url_id: undefined,
      finding_class: 'defect',
      page_kind: undefined,
    });
  });

  it('lists both classes unless the severity names a defect severity or the advisory level', () => {
    const wire = (severity: string) => {
      const params = toIssueParams({ ...emptyIssueFilters, severity });
      return [params.severity, params.finding_class];
    };
    expect(wire('')).toEqual([undefined, undefined]);
    expect(wire('high')).toEqual(['high', 'defect']);
    expect(wire('advisory')).toEqual([undefined, 'advisory']);
    expect(wire('critical')).toEqual([undefined, undefined]);
  });

  it('maps the rule_id filter onto the wire `rule` param', () => {
    const params = toIssueParams({ ...emptyIssueFilters, rule_id: 'meta.title' });
    expect(params.rule).toBe('meta.title');
    expect('rule_id' in params).toBe(false);
  });

  it('trims the query and passes the tab, order and page kind through', () => {
    const params = toIssueParams({
      ...emptyIssueFilters,
      section: 'aeo',
      sort: 'pages',
      query: '  schema  ',
      page_kind: 'faq',
    });
    expect(params).toMatchObject({
      section: 'aeo',
      sort: 'pages',
      query: 'schema',
      page_kind: 'faq',
    });
  });
});

describe('issueFilterParams (the URL patch)', () => {
  it('writes every set filter', () => {
    expect(
      issueFilterParams({
        section: 'content',
        sort: 'pages',
        query: '  schema  ',
        severity: 'high',
        category: 'metadata',
        rule_id: 'meta.title',
        site_url_id: 'u1',
        page_kind: 'product',
      }),
    ).toEqual({
      section: 'content',
      sort: 'pages',
      query: 'schema',
      severity: 'high',
      category: 'metadata',
      rule: 'meta.title',
      site_url_id: 'u1',
      page_kind: 'product',
    });
  });

  it('clears every key the defaults leave unset, so nothing lingers in the URL', () => {
    expect(Object.values(issueFilterParams(emptyIssueFilters)).every((v) => v === null)).toBe(true);
  });
});

describe('the severity choice', () => {
  it('reads a known severity, and otherwise "all"', () => {
    expect(issueSeverityChoice({ ...emptyIssueFilters, severity: 'medium' })).toBe('medium');
    expect(issueSeverityChoice({ ...emptyIssueFilters, severity: 'advisory' })).toBe('advisory');
    expect(issueSeverityChoice(emptyIssueFilters)).toBe('all');
    expect(issueSeverityChoice({ ...emptyIssueFilters, severity: 'critical' })).toBe('all');
  });

  it('sets the severity, and "all" clears it', () => {
    expect(issueSeverityChange('low')).toEqual({ severity: 'low' });
    expect(issueSeverityChange('all')).toEqual({ severity: '' });
  });
});
