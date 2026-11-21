import type { RankingRow, WinCounts } from '@citeladder/contracts';
import { endSentence, formattedText } from '@/lib/format';
import { formatRank } from '@/lib/visibility/dashboard';

export function competitorHref(name: string): `/${string}` {
  return `/competitors/${encodeURIComponent(name)}`;
}

export function winRateAbsence(
  row: Pick<WinCounts, 'win_answers'> | undefined,
): 'not_applicable' | 'not_measured' {
  return row?.win_answers === 0 ? 'not_applicable' : 'not_measured';
}

export function rankingRowKey(row: Pick<RankingRow, 'is_brand' | 'name'>): string {
  return `${row.is_brand}-${row.name}`;
}

export function orderByVisibility(rows: readonly RankingRow[]): RankingRow[] {
  return [...rows].sort(
    (a, b) => (b.mention_rate ?? -1) - (a.mention_rate ?? -1) || a.name.localeCompare(b.name),
  );
}

export type BrandStanding =
  | { kind: 'unmeasured' }
  | { kind: 'alone' }
  | { kind: 'competitors_unmeasured' }
  | {
      kind: 'ranked';
      rank: number;
      ahead: string | null;
      behind: string | null;
      tied: readonly string[];
    };

export function brandStanding(rows: readonly RankingRow[]): BrandStanding {
  const ordered = orderByVisibility(rows);
  const rate = ordered.find((row) => row.is_brand)?.mention_rate;
  if (rate == null) return { kind: 'unmeasured' };
  const competitors = ordered.filter((row) => !row.is_brand);
  if (!competitors.length) return { kind: 'alone' };
  const measured = competitors.filter((row) => row.mention_rate != null);
  if (!measured.length) return { kind: 'competitors_unmeasured' };
  const above = measured.filter((row) => (row.mention_rate ?? 0) > rate);
  return {
    kind: 'ranked',
    rank: above.length + 1,
    ahead: above.at(-1)?.name ?? null,
    behind: measured.find((row) => (row.mention_rate ?? 0) < rate)?.name ?? null,
    tied: measured.filter((row) => row.mention_rate === rate).map((row) => row.name),
  };
}

function nameList(names: readonly string[]): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

type Ranked = Extract<BrandStanding, { kind: 'ranked' }>;

function neighbourLine({ ahead, behind }: Ranked): string | null {
  if (ahead) return `${ahead} is named more often.`;
  if (behind) return endSentence(`You're named more often than ${behind}`);
  return null;
}

function tieLine(tied: Ranked['tied']): string | null {
  if (!tied.length) return null;
  return `${nameList(tied)} ${tied.length > 1 ? 'are' : 'is'} named as often as you.`;
}

export function standingHeadline(standing: BrandStanding): {
  headline: string;
  sub: string | null;
} {
  switch (standing.kind) {
    case 'unmeasured':
      return { headline: 'No AI visibility readings for you in this selection', sub: null };
    case 'alone':
      return { headline: "You aren't tracking any competitors yet", sub: null };
    case 'competitors_unmeasured':
      return {
        headline: 'No visibility readings for your competitors in this selection',
        sub: null,
      };
    case 'ranked': {
      const sub = [neighbourLine(standing), tieLine(standing.tied)].filter(Boolean).join(' ');
      return {
        headline: `You're ${formattedText(formatRank(standing.rank))} in AI visibility`,
        sub: sub || null,
      };
    }
    default: {
      const unreachable: never = standing;
      return unreachable;
    }
  }
}
