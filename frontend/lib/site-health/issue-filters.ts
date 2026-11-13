/**
 * The Site Health issues catalog's filter state — ONE owner.
 *
 * This module holds the filter model, its address-bar round-trip (through
 * `lib/navigation/url-state.ts`, the app's url-state primitive), the severity
 * choices, and the request params the issues query sends. The tab (Technical,
 * Content, AEO) and the ordering are URL state like the filters.
 *
 * Cursors are opaque and filter-bound on the server — replaying one under
 * changed filters is refused — so a filter edit drops the catalog cursor, the
 * open issue and its occurrence stack together, in one history entry. The
 * occurrence stack lives here for the same reason: it is only meaningful under
 * a fixed (filters, page, issue) triple, and every caller that moved one of
 * those used to have to remember to reset it.
 */
import { useCallback, useMemo, useState } from 'react';

import type { IssueSection, IssueSort } from '@citeladder/contracts';
import type { IssuesParams } from '@/lib/api/site-health';
import { ISSUE_PAGE_LIMIT } from '@/lib/config/site-health';
import {
  optionalStringUrlCodec,
  setUrlParams,
  stringUrlCodec,
  useUrlState,
  type UrlCodec,
} from '@/lib/navigation/url-state';

export type FindingClass = 'defect' | 'advisory';

/** Issue filter model (drives the issues query + URL state). */
export type IssueFilters = {
  /** The tab: every issue belongs to exactly one. */
  section: IssueSection;
  sort: IssueSort;
  query: string;
  severity: string;
  category: string;
  /** Internal key for the wire's `rule` param. */
  rule_id: string;
  site_url_id: string;
  finding_class: FindingClass;
  /** v2 P1 page-kind filter ('' = all types). */
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
  finding_class: 'defect',
  page_kind: '',
};

/** The tabs in reading order, with their names. */
export const ISSUE_SECTIONS: ReadonlyArray<{ value: IssueSection; label: string }> = [
  { value: 'technical', label: 'Technical' },
  { value: 'content', label: 'Content' },
  { value: 'aeo', label: 'AEO' },
];

/** A free-text filter: absent in the URL is '', and blank never serializes. */
const textCodec: UrlCodec<string> = {
  parse: (raw) => raw ?? '',
  serialize: (value) => value.trim() || null,
};
const findingClassCodec = stringUrlCodec(['defect', 'advisory'] as const, 'defect');
const sectionCodec = stringUrlCodec(['technical', 'content', 'aeo'] as const, 'technical');
const sortCodec = stringUrlCodec(['severity', 'pages'] as const, 'severity');

const SEVERITY_CLASSES = ['high', 'medium', 'low'] as const;

/** A severity choice; `all` leaves severity unfiltered. */
export type IssueSeverityChoice = 'all' | (typeof SEVERITY_CLASSES)[number];

const SEVERITY_CHOICE_LABELS: Readonly<Record<IssueSeverityChoice, string>> = {
  all: 'All severities',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

function isSeverityClass(value: string): value is (typeof SEVERITY_CLASSES)[number] {
  return (SEVERITY_CLASSES as readonly string[]).includes(value);
}

/** The severity choices on offer, the unfiltered one naming what it leaves unfiltered. */
export const ISSUE_SEVERITY_CHOICES: ReadonlyArray<{ key: IssueSeverityChoice; label: string }> = (
  ['all', ...SEVERITY_CLASSES] as const
).map((key) => ({ key, label: SEVERITY_CHOICE_LABELS[key] }));

/** Which severity choice the current filters read as. */
export function issueSeverityChoice(filters: IssueFilters): IssueSeverityChoice {
  return isSeverityClass(filters.severity) ? filters.severity : 'all';
}

/** The severity a choice selects — 'all' clears it. */
export function issueSeverityChange(key: IssueSeverityChoice): Pick<IssueFilters, 'severity'> {
  return { severity: key === 'all' ? '' : key };
}

/**
 * Switching defects/advisories clears the severity with it: severities are
 * defect-only, so an advisory view holding `severity=high` would filter on a
 * choice it does not even offer.
 */
export function findingClassChange(finding_class: FindingClass): Partial<IssueFilters> {
  return { finding_class, severity: '' };
}

/** Build issue request params. */
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
    severity: filters.severity || undefined,
    category: filters.category || undefined,
    // The backend issues endpoint names the rule filter `rule` (not `rule_id`);
    // the `IssueFilters` model keeps `rule_id` as its internal URL-state key.
    rule: filters.rule_id || undefined,
    site_url_id: filters.site_url_id || undefined,
    finding_class: filters.finding_class,
    page_kind: filters.page_kind || undefined,
  };
}

/**
 * The catalog's list request. The catalog and the route prefetch both build
 * it here so they share one cache entry.
 */
export function issueCatalogParams(filters: IssueFilters, cursor: string | null): IssuesParams {
  return toIssueParams(filters, cursor, ISSUE_PAGE_LIMIT);
}

/** How many of the worst issues the summary's priority list names. */
const PRIORITY_ISSUE_COUNT = 3;

/**
 * The summary's request: the crawl's worst defects, unfiltered and across
 * every tab, whose summary counts the whole crawl. The persisted catalog
 * answers it, and the route prefetch starts it beside the list.
 */
export const ISSUE_PRIORITY_PARAMS: IssuesParams = {
  limit: PRIORITY_ISSUE_COUNT,
  finding_class: 'defect',
};

/**
 * Every URL key this module owns, as a `setUrlParams` patch. Params it does
 * not name (an inbound `campaign=`, say) survive untouched.
 */
export function issueFilterParams(filters: IssueFilters): Record<string, string | null> {
  return {
    section: sectionCodec.serialize(filters.section),
    sort: sortCodec.serialize(filters.sort),
    query: textCodec.serialize(filters.query),
    severity: textCodec.serialize(filters.severity),
    category: textCodec.serialize(filters.category),
    rule: textCodec.serialize(filters.rule_id),
    site_url_id: textCodec.serialize(filters.site_url_id),
    finding_class: findingClassCodec.serialize(filters.finding_class),
    page_kind: textCodec.serialize(filters.page_kind),
  };
}

/**
 * The catalog's whole "where am I looking": URL-owned filters, page cursor and
 * selected issue, plus the rail's occurrence stack. Callers move it with verbs
 * — the resets each verb implies happen here, once.
 */
export function useIssueFilters() {
  const [section] = useUrlState('section', sectionCodec);
  const [sort] = useUrlState('sort', sortCodec);
  const [query] = useUrlState('query', textCodec);
  const [severity] = useUrlState('severity', textCodec);
  const [category] = useUrlState('category', textCodec);
  const [rule] = useUrlState('rule', textCodec);
  const [siteUrlId] = useUrlState('site_url_id', textCodec);
  const [findingClass] = useUrlState('finding_class', findingClassCodec);
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
      finding_class: findingClass,
      page_kind: pageKind,
    }),
    [section, sort, query, severity, category, rule, siteUrlId, findingClass, pageKind],
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

  /** Turn the catalog page. A selection belongs to the page it came from. */
  const goToPage = useCallback(
    (next: string | null) => {
      setUrlParams({ ...issueFilterParams(filters), cursor: next, issue: null });
      setOccurrenceCursors([]);
    },
    [filters],
  );

  /** Open an issue from its first page of occurrences, or close it with null. */
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
