import { useCallback, useMemo, useState } from 'react';

import type { IssueSection, IssueSort } from '@citeladder/contracts';
import type { IssuesParams } from '@/lib/api/site-health';
import { ISSUE_PAGE_LIMIT } from '@/lib/config/site-health';
import { isOneOf } from '@/lib/utils';
import {
  optionalStringUrlCodec,
  setUrlParams,
  stringUrlCodec,
  useUrlState,
  type UrlCodec,
} from '@/lib/navigation/url-state';

export type IssueFilters = {
  section: IssueSection;
  sort: IssueSort;
  query: string;
  severity: string;
  category: string;
  rule_id: string;
  site_url_id: string;
  page_kind: string;
};

export const emptyIssueFilters: IssueFilters = {
  section: 'technical',
  sort: 'severity',
  query: '',
  severity: '',
  category: '',
  rule_id: '',
  site_url_id: '',
  page_kind: '',
};

export const ISSUE_SECTIONS: ReadonlyArray<{ value: IssueSection; label: string }> = [
  { value: 'technical', label: 'Technical' },
  { value: 'content', label: 'Content' },
  { value: 'aeo', label: 'AEO' },
];

const textCodec: UrlCodec<string> = {
  parse: (raw) => raw ?? '',
  serialize: (value) => value.trim() || null,
};
const sectionCodec = stringUrlCodec(['technical', 'content', 'aeo'] as const, 'technical');
const sortCodec = stringUrlCodec(['severity', 'pages'] as const, 'severity');

const SEVERITY_CLASSES = ['high', 'medium', 'low', 'advisory'] as const;

export type IssueSeverityChoice = 'all' | (typeof SEVERITY_CLASSES)[number];

const SEVERITY_CHOICE_LABELS: Readonly<Record<IssueSeverityChoice, string>> = {
  all: 'All severities',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  advisory: 'Advisory',
};

function isSeverityClass(value: string): value is (typeof SEVERITY_CLASSES)[number] {
  return isOneOf(SEVERITY_CLASSES, value);
}

export const ISSUE_SEVERITY_CHOICES: ReadonlyArray<{ key: IssueSeverityChoice; label: string }> = (
  ['all', ...SEVERITY_CLASSES] as const
).map((key) => ({ key, label: SEVERITY_CHOICE_LABELS[key] }));

export function issueSeverityChoice(filters: IssueFilters): IssueSeverityChoice {
  return isSeverityClass(filters.severity) ? filters.severity : 'all';
}

export function issueSeverityChange(key: IssueSeverityChoice): Pick<IssueFilters, 'severity'> {
  return { severity: key === 'all' ? '' : key };
}

function severityParams(severity: string): Pick<IssuesParams, 'severity' | 'finding_class'> {
  if (severity === 'advisory') return { finding_class: 'advisory' };
  return isSeverityClass(severity) ? { severity, finding_class: 'defect' } : {};
}

export function toIssueParams(
  filters: IssueFilters,
  cursor?: string | null,
  limit?: number,
): IssuesParams {
  return {
    cursor: cursor ?? undefined,
    limit,
    section: filters.section,
    sort: filters.sort,
    query: filters.query.trim() || undefined,
    ...severityParams(filters.severity),
    category: filters.category || undefined,
    rule: filters.rule_id || undefined,
    site_url_id: filters.site_url_id || undefined,
    page_kind: filters.page_kind || undefined,
  };
}

export function issueCatalogParams(filters: IssueFilters, cursor: string | null): IssuesParams {
  return toIssueParams(filters, cursor, ISSUE_PAGE_LIMIT);
}

const PRIORITY_ISSUE_COUNT = 3;

export const ISSUE_PRIORITY_PARAMS: IssuesParams = { limit: PRIORITY_ISSUE_COUNT };

export function issueFilterParams(filters: IssueFilters): Record<string, string | null> {
  return {
    section: sectionCodec.serialize(filters.section),
    sort: sortCodec.serialize(filters.sort),
    query: textCodec.serialize(filters.query),
    severity: textCodec.serialize(filters.severity),
    category: textCodec.serialize(filters.category),
    rule: textCodec.serialize(filters.rule_id),
    site_url_id: textCodec.serialize(filters.site_url_id),
    page_kind: textCodec.serialize(filters.page_kind),
  };
}

export function useIssueFilters() {
  const [section] = useUrlState('section', sectionCodec);
  const [sort] = useUrlState('sort', sortCodec);
  const [query] = useUrlState('query', textCodec);
  const [severity] = useUrlState('severity', textCodec);
  const [category] = useUrlState('category', textCodec);
  const [rule] = useUrlState('rule', textCodec);
  const [siteUrlId] = useUrlState('site_url_id', textCodec);
  const [pageKind] = useUrlState('page_kind', textCodec);
  const [cursor] = useUrlState('cursor', optionalStringUrlCodec);
  const [selectedGroupId] = useUrlState('issue', optionalStringUrlCodec);
  const [occurrenceCursors, setOccurrenceCursors] = useState<string[]>([]);

  const filters = useMemo<IssueFilters>(
    () => ({
      section,
      sort,
      query,
      severity,
      category,
      rule_id: rule,
      site_url_id: siteUrlId,
      page_kind: pageKind,
    }),
    [section, sort, query, severity, category, rule, siteUrlId, pageKind],
  );

  /**
   * Apply a filter change: back to page one, no selection, no occurrence
   * stack. A deep link's one-rule filter (`rule=`, from an Overview row) ends
   * with any other change: kept, it silently held every count at one issue.
   */
  const updateFilters = useCallback(
    (change: Partial<IssueFilters>) => {
      const next = { ...filters, rule_id: '', ...change };
      setUrlParams({ ...issueFilterParams(next), cursor: null, issue: null });
      setOccurrenceCursors([]);
    },
    [filters],
  );

  const goToPage = useCallback(
    (next: string | null) => {
      setUrlParams({ ...issueFilterParams(filters), cursor: next, issue: null });
      setOccurrenceCursors([]);
    },
    [filters],
  );

  const selectIssue = useCallback((groupId: string | null) => {
    setUrlParams({ issue: groupId });
    setOccurrenceCursors([]);
  }, []);

  const nextOccurrences = useCallback(
    (next: string) => setOccurrenceCursors((values) => [...values, next]),
    [],
  );
  const previousOccurrences = useCallback(
    () => setOccurrenceCursors((values) => values.slice(0, -1)),
    [],
  );

  return {
    filters,
    cursor,
    selectedGroupId,
    occurrenceCursor: occurrenceCursors.at(-1),
    canPageOccurrencesBack: occurrenceCursors.length > 0,
    nextOccurrences,
    previousOccurrences,
    updateFilters,
    goToPage,
    selectIssue,
  };
}
