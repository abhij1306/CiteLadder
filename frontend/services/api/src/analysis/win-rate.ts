import { firstNamedSchema, type FirstNamed } from '@citeladder/contracts/audits';
import type { WinCounts } from '@citeladder/contracts/visibility';
import { z } from 'zod';

import { compareText } from '../text-order.ts';

export function firstNamed(input: {
  brandName: string;
  brandOffset: number | null;
  competitorOffsets: Readonly<Record<string, number>>;
}): FirstNamed {
  let first: FirstNamed =
    input.brandOffset === null ? { kind: 'none' } : { kind: 'brand', name: input.brandName };
  let at = input.brandOffset;
  const competitors = Object.entries(input.competitorOffsets).sort(([a], [b]) => compareText(a, b));
  for (const [name, offset] of competitors) {
    if (at === null || offset < at) {
      first = { kind: 'competitor', name };
      at = offset;
    }
  }
  return first;
}

export function firstNamedColumns(first: FirstNamed) {
  return {
    first_named_kind: first.kind,
    first_named_name: first.kind === 'none' ? null : first.name,
  };
}

type StoredFirstNamed = { first_named_kind: string; first_named_name: string | null };

export function storedFirstNamed(row: StoredFirstNamed): FirstNamed {
  return firstNamedSchema.parse({
    kind: row.first_named_kind,
    ...(row.first_named_name === null ? {} : { name: row.first_named_name }),
  });
}

const winTallySchema = z.object({
  answers: z.number().int(),
  first: z.record(z.string(), z.number().int()),
});
export type WinTally = z.infer<typeof winTallySchema>;

// Own keys only: a tracked name such as "constructor" must not read Object.prototype.
const ownCount = (first: WinTally['first'], name: string) =>
  Object.hasOwn(first, name) ? first[name]! : 0;

export function winTally(answers: readonly FirstNamed[], brandKey: string): WinTally {
  const first: Record<string, number> = {};
  let counted = 0;
  for (const named of answers) {
    let key: string;
    switch (named.kind) {
      case 'none':
        continue;
      case 'brand':
        key = brandKey;
        break;
      case 'competitor':
        key = named.name;
        break;
      default: {
        const unreachable: never = named;
        throw new Error(`unknown first-named kind: ${JSON.stringify(unreachable)}`);
      }
    }
    first[key] = ownCount(first, key) + 1;
    counted++;
  }
  return { answers: counted, first };
}

export function storedWinTally(value: unknown): WinTally | null {
  return value === undefined ? null : winTallySchema.parse(value);
}

const UNAVAILABLE: WinCounts = { win_count: null, win_answers: null, win_rate: null };

const counted = (count: number, answers: number): WinCounts => ({
  win_count: count,
  win_answers: answers,
  win_rate: answers ? count / answers : null,
});

export function brandWinCounts(rows: readonly StoredFirstNamed[]): WinCounts {
  const named = rows.map(storedFirstNamed);
  return counted(
    named.filter((answer) => answer.kind === 'brand').length,
    named.filter((answer) => answer.kind !== 'none').length,
  );
}

export function sumWinCounts(parts: readonly WinCounts[]): WinCounts {
  let count = 0;
  let answers = 0;
  for (const part of parts) {
    if (part.win_count == null || part.win_answers == null) return UNAVAILABLE;
    count += part.win_count;
    answers += part.win_answers;
  }
  return parts.length ? counted(count, answers) : UNAVAILABLE;
}

export function winCounts(tally: WinTally | null, name: string): WinCounts {
  return tally === null ? UNAVAILABLE : counted(ownCount(tally.first, name), tally.answers);
}
