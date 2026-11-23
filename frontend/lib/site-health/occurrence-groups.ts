import type { IssueOccurrence } from '@citeladder/contracts';

import { evidenceFacts, evidenceLead } from './issue-evidence';

type NonEmpty<T> = [T, ...T[]];

export type OccurrenceEntry<T extends IssueOccurrence = IssueOccurrence> =
  | Readonly<{ kind: 'page'; occurrence: T }>
  | Readonly<{
      kind: 'shared';
      key: string;
      ruleId: string;
      facts: readonly string[];
      occurrences: NonEmpty<T>;
      pageCount: number;
    }>;

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

export function groupOccurrences<T extends IssueOccurrence>(
  occurrences: readonly T[],
): OccurrenceEntry<T>[] {
  const buckets = new Map<string, { facts: string[]; members: T[] }>();
  const order: Array<{ key: string } | { occurrence: T }> = [];
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
  return order.flatMap((slot): OccurrenceEntry<T>[] => {
    if ('occurrence' in slot) return [{ kind: 'page', occurrence: slot.occurrence }];
    const bucket = buckets.get(slot.key);
    if (!bucket) return [];
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

export function loadedPageCount(occurrences: readonly IssueOccurrence[]): number {
  return distinctPages(occurrences);
}
