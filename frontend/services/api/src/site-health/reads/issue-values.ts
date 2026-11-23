import type { IssueValue } from '@citeladder/contracts/site-health';
import { z } from 'zod';

import { policy } from '../../config.ts';
import { record } from '../../db/json.ts';

const valueKindSchema = z.enum(['title', 'meta_description', 'h1_count', 'word_count']);
type ValueKind = z.infer<typeof valueKindSchema>;

const VALUE_KINDS: ReadonlyMap<string, ValueKind> = new Map(
  Object.entries(
    z.record(z.string(), valueKindSchema).parse(policy.site_health.reads.issue_values),
  ),
);

function textValue(kind: 'title' | 'meta_description', evidence: unknown): IssueValue {
  const raw = record(evidence)[kind];
  if (typeof raw !== 'string') return { kind: 'unavailable' };
  const text = raw.replaceAll(/\s+/gu, ' ').trim();
  return { kind, text, length: [...text].length };
}

function countValue(kind: 'h1_count' | 'word_count', evidence: unknown): IssueValue {
  const value = record(evidence)[kind];
  return typeof value === 'number' ? { kind, count: Math.trunc(value) } : { kind: 'unavailable' };
}

export function issueValue(ruleId: string, evidence: unknown): IssueValue {
  const kind = VALUE_KINDS.get(ruleId);
  switch (kind) {
    case undefined:
      return { kind: 'none' };
    case 'title':
    case 'meta_description':
      return textValue(kind, evidence);
    case 'h1_count':
    case 'word_count':
      return countValue(kind, evidence);
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}
