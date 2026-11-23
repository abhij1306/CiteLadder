import type { IssueSort } from '@citeladder/contracts/site-health';

import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidCursorError,
} from '../../http/keyset-cursor.ts';
import { compareText } from '../../text-order.ts';
import { severityRank } from './rules.ts';

type GroupKey = readonly [rank: number, affected: number, rule: string, group: string];
type Ranked = Readonly<{
  severity: string;
  affected_url_count: number;
  rule_id: string;
  group_id: string;
}>;
const groupKey = (group: Ranked): GroupKey =>
  [severityRank(group.severity), group.affected_url_count, group.rule_id, group.group_id] as const;

const byIdentity = (a: GroupKey, b: GroupKey) => compareText(a[2], b[2]) || compareText(a[3], b[3]);
const bySeverity = (a: GroupKey, b: GroupKey) => a[0] - b[0];

const KEY_ORDER: Readonly<Record<IssueSort, (a: GroupKey, b: GroupKey) => number>> = {
  severity: (a, b) => bySeverity(a, b) || b[1] - a[1] || byIdentity(a, b),
  pages: (a, b) => b[1] - a[1] || bySeverity(a, b) || byIdentity(a, b),
};

export const groupOrder =
  (sort: IssueSort) =>
  (a: Ranked, b: Ranked): number =>
    KEY_ORDER[sort](groupKey(a), groupKey(b));

export const groupCursorAfter = (fingerprint: Record<string, unknown>, last: Ranked) =>
  encodeKeysetCursor('issues', fingerprint, groupKey(last).map(String));

export function resumeIndex(groups: readonly Ranked[], sort: IssueSort, after: GroupKey | null) {
  if (!after) return 0;
  return groups.findIndex((group) => KEY_ORDER[sort](groupKey(group), after) > 0);
}

export function decodeGroupCursor(cursor: string | null, fingerprint: Record<string, unknown>) {
  if (!cursor) return null;
  const [rank, affected, rule, id, ...rest] = decodeKeysetCursor(cursor, 'issues', fingerprint);
  if (
    rank === undefined ||
    affected === undefined ||
    rule === undefined ||
    id === undefined ||
    rest.length > 0
  )
    throw new InvalidCursorError('invalid cursor');
  if (!/^\d{1,3}$/u.test(rank) || !/^\d{1,9}$/u.test(affected))
    throw new InvalidCursorError('invalid cursor');
  return [Number(rank), Number(affected), rule, id] as const;
}
