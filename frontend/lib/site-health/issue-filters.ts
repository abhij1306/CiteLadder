'use client';

/**
 * The Site Health issues catalog's filter state — ONE owner.
 *
 * This module holds the filter model, its address-bar round-trip (through
 * `lib/navigation/url-state.ts`, the app's url-state primitive), the
 * severity/dimension pairs behind the segmented control, and the request
 * params the issues query sends. Ordering is URL-only in this release, so
 * there is no sort field to serialize.
 *
 * Cursors are opaque and filter-bound on the server — replaying one under
 * changed filters is refused — so a filter edit drops the catalog cursor, the
 * selected issue and the rail's occurrence stack together, in one history
 * entry. The occurrence stack lives here for the same reason: it is only
 * meaningful under a fixed (filters, page, issue) triple, and every caller
 * that moved one of those used to have to remember to reset it.
 */
import { useCallback, useMemo, useState } from 'react';

import type { IssuesParams } from '@/lib/api/site-health';
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
  query: string;
  severity: string;
  category: string;
  dimension: string;
  /** Internal key for the wire's `rule` param. */
  rule_id: string;
  site_url_id: string;
  finding_class: FindingClass;
  /** v2 P1 page-kind filter ('' = all types). */
  page_kind: string;
};

export const emptyIssueFilters: IssueFilters = {
  query: '',
  severity: '',
  category: '',
  dimension: '',
  rule_id: '',
  site_url_id: '',
  finding_class: 'defect',
  page_kind: '',
};

/** A free-text filter: absent in the URL is '', and blank never serializes. */
const textCodec: UrlCodec<string> = {
  parse: (raw) => raw ?? '',
  serialize: (value) => value.trim() || null,
};
const findingClassCodec = stringUrlCodec(['defect', 'advisory'] as const, 'defect');

const SEVERITY_CLASSES = ['high', 'medium', 'low'] as const;
const DIMENSION_CLASSES = ['technical', 'aeo'] as const;

/** The one segmented control over severity AND dimension: picking either clears the other. */
export type IssueFilterClass =
  | 'all'
  | (typeof SEVERITY_CLASSES)[number]
  | (typeof DIMENSION_CLASSES)[number];

const FILTER_CLASS_LABELS: Readonly<Record<IssueFilterClass, string>> = {
  all: 'All',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  technical: 'Web Fundamentals',
  aeo: 'AEO',
};

function isSeverityClass(value: string): value is (typeof SEVERITY_CLASSES)[number] {
  return (SEVERITY_CLASSES as readonly string[]).includes(value);
}

function isDimensionClass(value: string): value is (typeof DIMENSION_CLASSES)[number] {
  return (DIMENSION_CLASSES as readonly string[]).includes(value);
}

/** The segments on offer. Advisories carry no severity, so they list dimensions only. */
export function issueFilterClasses(
  findingClass: FindingClass,
): ReadonlyArray<{ key: IssueFilterClass; label: string }> {
  const keys: readonly IssueFilterClass[] =
    findingClass === 'defect'
      ? ['all', ...SEVERITY_CLASSES, ...DIMENSION_CLASSES]
      : ['all', ...DIMENSION_CLASSES];
  return keys.map((key) => ({ key, label: FILTER_CLASS_LABELS[key] }));
}

/** Which segment the current filters read as. */
export function issueFilterClass(filters: IssueFilters): IssueFilterClass {
  if (isSeverityClass(filters.severity)) return filters.severity;
  if (isDimensionClass(filters.dimension)) return filters.dimension;
  return 'all';
}

/** The severity/dimension PAIR a segment selects — 'all' clears both. */
export function issueFilterClassChange(
  key: IssueFilterClass,
): Pick<IssueFilters, 'severity' | 'dimension'> {
  return {
    severity: isSeverityClass(key) ? key : '',
    dimension: isDimensionClass(key) ? key : '',
  };
}

/**
 * Switching defects/advisories resets the class with it: severities are
 * defect-only, so an advisory view holding `severity=high` would filter on a
 * segment it does not even offer.
 */
export function findingClassChange(finding_class: FindingClass): Partial<IssueFilters> {
  return { finding_class, ...issueFilterClassChange('all') };
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
    query: filters.query.trim() || undefined,
    severity: filters.severity || undefined,
    category: filters.category || undefined,
    dimension: filters.dimension || undefined,
    // The backend issues endpoint names the rule filter `rule` (not `rule_id`);
    // the `IssueFilters` model keeps `rule_id` as its internal URL-state key.
    rule: filters.rule_id || undefined,
    site_url_id: filters.site_url_id || undefined,
    finding_class: filters.finding_class,
    page_kind: filters.page_kind || undefined,
  };
}

/**
 * Every URL key this module owns, as a `setUrlParams` patch. Params it does
 * not name (an inbound `campaign=`, say) survive untouched.
 */
export function issueFilterParams(filters: IssueFilters): Record<string, string | null> {
  return {
    query: textCodec.serialize(filters.query),
    severity: textCodec.serialize(filters.severity),
    category: textCodec.serialize(filters.category),
    dimension: textCodec.serialize(filters.dimension),
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
  const [query] = useUrlState('query', textCodec);
  const [severity] = useUrlState('severity', textCodec);
  const [category] = useUrlState('category', textCodec);
  const [dimension] = useUrlState('dimension', textCodec);
  const [rule] = useUrlState('rule', textCodec);
  const [siteUrlId] = useUrlState('site_url_id', textCodec);
  const [findingClass] = useUrlState('finding_class', findingClassCodec);
  const [pageKind] = useUrlState('page_kind', textCodec);
  const [cursor] = useUrlState('cursor', optionalStringUrlCodec);
  const [selectedGroupId] = useUrlState('issue', optionalStringUrlCodec);
  const [occurrenceCursors, setOccurrenceCursors] = useState<string[]>([]);

  const filters = useMemo<IssueFilters>(
    () => ({
      query,
      severity,
      category,
      dimension,
      rule_id: rule,
      site_url_id: siteUrlId,
      finding_class: findingClass,
      page_kind: pageKind,
    }),
    [query, severity, category, dimension, rule, siteUrlId, findingClass, pageKind],
  );

  /** Apply a filter change: back to page one, no selection, no occurrence stack. */
  const updateFilters = useCallback(
    (change: Partial<IssueFilters>) => {
      setUrlParams({ ...issueFilterParams({ ...filters, ...change }), cursor: null, issue: null });
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

  /** Show another issue in the rail, from its first page of occurrences. */
  const selectIssue = useCallback((groupId: string) => {
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
