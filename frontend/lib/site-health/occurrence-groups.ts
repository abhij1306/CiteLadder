/**
 * The affected-page list of one issue, grouped by what was found.
 *
 * A form-control finding on a site-wide newsletter field is ONE template
 * element on every page, and listing it as N rows that each repeat
 * `input[name="email"]` and their own "Ask agent" presented one fix as N
 * jobs. Occurrences whose rendered evidence is identical become one shared
 * entry: the evidence once, then the pages it was found on.
 *
 * Equality is on what the evidence line RENDERS (`evidenceFacts`), not on the
 * raw evidence record: two records that differ only in an ordinal or an id
 * print the same line and are the same fix. A line that depends on the page it
 * is printed under ("→ this page") is never shared, because under a list of
 * pages it would point at none of them.
 *
 * Only the occurrences actually loaded are grouped. The detail read is paged,
 * so a group's count is how many of the LOADED pages share the evidence, and
 * the label says so unless the loaded list is the whole list.
 */

import type { IssueOccurrence } from '@citeladder/contracts';

import { evidenceFacts, evidenceLead } from './issue-evidence';

type NonEmpty<T> = [T, ...T[]];

export type OccurrenceEntry =
  | Readonly<{ kind: 'page'; occurrence: IssueOccurrence }>
  | Readonly<{
      kind: 'shared';
      key: string;
      ruleId: string;
      facts: readonly string[];
      /** One occurrence per page: the last one loaded for that page. */
      occurrences: NonEmpty<IssueOccurrence>;
      /** Distinct pages in the group. */
      pageCount: number;
    }>;

/** The rendered evidence line, or null when it is empty or names the page it sits under. */
function sharedFacts(occurrence: IssueOccurrence): string[] | null {
  const facts = evidenceFacts(occurrence.rule_id, occurrence.evidence, {
    pageUrl: occurrence.normalized_url,
  });
  if (facts.length === 0) return null;
  const detached = evidenceFacts(occurrence.rule_id, occurrence.evidence);
  const pageIndependent =
    detached.length === facts.length && detached.every((fact, index) => fact === facts[index]);
  return pageIndependent ? facts : null;
}

function distinctPages(occurrences: readonly IssueOccurrence[]): number {
  return new Set(occurrences.map((occurrence) => occurrence.site_url_id)).size;
}

/**
 * The loaded occurrences as entries, in the order the read ranked them: a
 * shared entry sits where its first page did. Evidence found on one page only
 * stays a per-page entry, as does an occurrence with no evidence line.
 */
export function groupOccurrences(occurrences: readonly IssueOccurrence[]): OccurrenceEntry[] {
  const buckets = new Map<string, { facts: string[]; members: IssueOccurrence[] }>();
  const order: Array<{ key: string } | { occurrence: IssueOccurrence }> = [];
  for (const occurrence of occurrences) {
    const facts = sharedFacts(occurrence);
    if (!facts) {
      order.push({ occurrence });
      continue;
    }
    const key = JSON.stringify([occurrence.rule_id, facts]);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.members.push(occurrence);
    } else {
      buckets.set(key, { facts, members: [occurrence] });
      order.push({ key });
    }
  }
  return order.flatMap((slot): OccurrenceEntry[] => {
    if ('occurrence' in slot) return [{ kind: 'page', occurrence: slot.occurrence }];
    const bucket = buckets.get(slot.key);
    if (!bucket) return [];
    // One row per page: a page that repeats the evidence is still one page.
    const [first, ...rest] = [
      ...new Map(bucket.members.map((member) => [member.site_url_id, member])).values(),
    ];
    if (!first) return [];
    if (rest.length === 0)
      return bucket.members.map((occurrence) => ({ kind: 'page', occurrence }));
    return [
      {
        kind: 'shared',
        key: slot.key,
        ruleId: first.rule_id,
        facts: bucket.facts,
        occurrences: [first, ...rest],
        pageCount: rest.length + 1,
      },
    ];
  });
}

/**
 * The lead for evidence shown once over many pages. A per-page lead says "on
 * this page"; over a list of pages that names none of them.
 */
const SHARED_LEAD_BY_RULE: Readonly<Record<string, string>> = {
  'technical.internal_link_redirect': 'Links that redirect:',
  'technical.broken_internal_link': 'Broken links:',
};

export function sharedEvidenceLead(ruleId: string): string | null {
  return SHARED_LEAD_BY_RULE[ruleId] ?? evidenceLead(ruleId);
}

function pages(count: number): string {
  return count === 1 ? 'page' : 'pages';
}

/**
 * How many pages a shared entry covers, claiming no more than the loaded rows
 * prove. `complete` means the loaded rows are the whole list (one page of
 * results, nothing before or after it); only then is the group's count a fact
 * about the issue rather than about this page of results.
 */
export function sharedPagesLabel({
  pageCount,
  loadedPageCount,
  totalPageCount,
  complete,
}: Readonly<{
  pageCount: number;
  loadedPageCount: number;
  totalPageCount: number;
  complete: boolean;
}>): string {
  if (complete)
    return pageCount === totalPageCount
      ? `On all ${pageCount} affected ${pages(pageCount)}`
      : `On ${pageCount} ${pages(pageCount)}`;
  return pageCount === loadedPageCount
    ? `On all ${pageCount} ${pages(pageCount)} shown, of ${totalPageCount} affected`
    : `On ${pageCount} of the ${loadedPageCount} ${pages(loadedPageCount)} shown`;
}

/** Distinct pages among the loaded occurrences. */
export function loadedPageCount(occurrences: readonly IssueOccurrence[]): number {
  return distinctPages(occurrences);
}
