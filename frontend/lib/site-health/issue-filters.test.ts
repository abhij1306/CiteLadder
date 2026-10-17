import { describe, expect, it } from 'vite-plus/test';

import {
  emptyIssueFilters,
  findingClassChange,
  issueFilterClass,
  issueFilterClassChange,
  issueFilterClasses,
  issueFilterParams,
  toIssueParams,
} from './issue-filters';

describe('toIssueParams', () => {
  it('maps filters + cursor to request params, dropping empties', () => {
    expect(toIssueParams({ ...emptyIssueFilters, severity: 'low' }, 'C', 50)).toEqual({
      cursor: 'C',
      limit: 50,
      query: undefined,
      severity: 'low',
      category: undefined,
      dimension: undefined,
      rule: undefined,
      site_url_id: undefined,
      finding_class: 'defect',
      page_kind: undefined,
    });
  });

  it('maps the rule_id filter onto the wire `rule` param', () => {
    const params = toIssueParams({ ...emptyIssueFilters, rule_id: 'meta.title' });
    expect(params.rule).toBe('meta.title');
    expect('rule_id' in params).toBe(false);
  });

  it('trims the query and passes the page kind through', () => {
    const params = toIssueParams({ ...emptyIssueFilters, query: '  schema  ', page_kind: 'faq' });
    expect(params.query).toBe('schema');
    expect(params.page_kind).toBe('faq');
  });
});

describe('issueFilterParams (the URL patch)', () => {
  it('writes every set filter', () => {
    expect(
      issueFilterParams({
        query: '  schema  ',
        severity: 'high',
        category: 'metadata',
        dimension: 'aeo',
        rule_id: 'meta.title',
        site_url_id: 'u1',
        finding_class: 'advisory',
        page_kind: 'product',
      }),
    ).toEqual({
      query: 'schema',
      severity: 'high',
      category: 'metadata',
      dimension: 'aeo',
      rule: 'meta.title',
      site_url_id: 'u1',
      finding_class: 'advisory',
      page_kind: 'product',
    });
  });

  it('clears every key the defaults leave unset, so nothing lingers in the URL', () => {
    expect(Object.values(issueFilterParams(emptyIssueFilters)).every((v) => v === null)).toBe(true);
  });
});

describe('the severity/dimension segment', () => {
  it('reads a severity, then a dimension, and otherwise "all"', () => {
    expect(issueFilterClass({ ...emptyIssueFilters, severity: 'medium' })).toBe('medium');
    expect(issueFilterClass({ ...emptyIssueFilters, dimension: 'aeo' })).toBe('aeo');
    expect(issueFilterClass(emptyIssueFilters)).toBe('all');
    // An unrecognized inbound value is not a segment.
    expect(issueFilterClass({ ...emptyIssueFilters, severity: 'critical' })).toBe('all');
  });

  it('sets one half of the pair and clears the other', () => {
    expect(issueFilterClassChange('low')).toEqual({ severity: 'low', dimension: '' });
    expect(issueFilterClassChange('technical')).toEqual({ severity: '', dimension: 'technical' });
    expect(issueFilterClassChange('all')).toEqual({ severity: '', dimension: '' });
  });

  it('offers severities to defects only — advisories have none', () => {
    expect(issueFilterClasses('defect').map((item) => item.key)).toEqual([
      'all',
      'high',
      'medium',
      'low',
      'technical',
      'aeo',
    ]);
    expect(issueFilterClasses('advisory').map((item) => item.key)).toEqual([
      'all',
      'technical',
      'aeo',
    ]);
  });

  it('resets the segment when the finding class switches', () => {
    expect(findingClassChange('advisory')).toEqual({
      finding_class: 'advisory',
      severity: '',
      dimension: '',
    });
  });
});
