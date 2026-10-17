import type { AnswerStates } from '@citeladder/contracts/visibility';

import type { TrendEvent, TrendPoint } from '@/components/ui/trend-chart';
import type { PromptHistory, PromptMetricItem } from '@/lib/api/types';
import { formatDisplayDate, formatDisplayShortDate } from '@/lib/format';
import { formatWholePercent } from '@/lib/visibility/dashboard';

type HistoryPoint = PromptHistory['points'][number];
type Outcome = NonNullable<PromptMetricItem['outcomes']>[number];

/** Where one prompt's history lives. */
export function promptHistoryHref(promptId: string): `/${string}` {
  return `/prompts/${encodeURIComponent(promptId)}`;
}

const percent = (rate: number | null) => (rate === null ? null : rate * 100);

/**
 * The mention-rate line, one point per run. A run with no successful answer
 * is a gap, and a run measured under changed conditions starts a new line
 * rather than joining a change nobody observed.
 */
export function mentionRatePoints(points: readonly HistoryPoint[], timeZone: string): TrendPoint[] {
  return points.map((point) => {
    const value = percent(point.mention_rate);
    return {
      label: `${formatDisplayDate(point.completed_at, timeZone)} · ${formatWholePercent(value)}`,
      axisLabel: formatDisplayShortDate(point.completed_at, timeZone),
      value,
      timestamp: new Date(point.completed_at).getTime(),
      breakBefore: point.comparable_with_previous === false,
    };
  });
}

/** The owned-citation line on the same runs. */
export function ownedCitationValues(points: readonly HistoryPoint[]): (number | null)[] {
  return points.map((point) => percent(point.owned_citation_rate));
}

/** When each Action measured on this prompt was marked implemented. */
export function implementationEvents(
  implementations: PromptHistory['implementations'],
  timeZone: string,
): TrendEvent[] {
  return implementations.map((item) => ({
    key: `${item.action_id}:${item.implemented_at}`,
    timestamp: new Date(item.implemented_at).getTime(),
    label: `Marked implemented ${formatDisplayDate(item.implemented_at, timeZone)}: ${item.title}`,
  }));
}

/** The four answer states, in reading order, with what each one means. */
export const ANSWER_STATES = [
  {
    key: 'mentioned_and_cited',
    label: 'Mentioned and cited',
    meaning: 'Named you and cited one of your pages.',
  },
  {
    key: 'mentioned_only',
    label: 'Mentioned only',
    meaning: 'Named you without citing your site.',
  },
  {
    key: 'cited_only',
    label: 'Cited only',
    meaning: 'Cited your page without naming you.',
  },
  { key: 'neither', label: 'Neither', meaning: 'Did not name you or cite your site.' },
] as const satisfies readonly { key: keyof AnswerStates; label: string; meaning: string }[];

/** One competitor named in answers that left the brand out. */
export type CompetitorGap = { name: string; answers: number; engines: string[] };

/** Competitors named where the brand was not, most answers first. */
export function competitorGaps(outcomes: readonly Outcome[]): CompetitorGap[] {
  const byName = new Map<string, CompetitorGap>();
  for (const outcome of outcomes) {
    for (const [name, answers] of Object.entries(outcome.gap_counts)) {
      const gap = byName.get(name) ?? { name, answers: 0, engines: [] };
      gap.answers += answers;
      if (!gap.engines.includes(outcome.logical_engine)) gap.engines.push(outcome.logical_engine);
      byName.set(name, gap);
    }
  }
  return [...byName.values()].sort(
    (left, right) => right.answers - left.answers || left.name.localeCompare(right.name),
  );
}

/** A prompt and engines where answers named a competitor but not the brand. */
export type MissingPrompt = {
  promptId: string;
  text: string;
  actionId: string | null;
  engines: string[];
  competitors: string[];
};

/**
 * The latest run's prompts where at least one answer named a competitor and
 * not the brand, those with the most competitor mentions first. A prompt with
 * no such answer, or no successful answer, is not listed: absence of evidence
 * is not a gap.
 */
export function missingPrompts(items: readonly PromptMetricItem[]): MissingPrompt[] {
  return items
    .flatMap((item) => {
      if (!item.prompt_id) return [];
      const gapped = (item.outcomes ?? []).filter(
        (outcome) => Object.keys(outcome.gap_counts).length > 0,
      );
      if (gapped.length === 0) return [];
      const gaps = competitorGaps(gapped);
      return [
        {
          weight: gaps.reduce((total, gap) => total + gap.answers, 0),
          row: {
            promptId: item.prompt_id,
            text: item.prompt_text,
            actionId: item.action_id ?? null,
            engines: [...new Set(gapped.map((outcome) => outcome.logical_engine))].sort(
              (left, right) => left.localeCompare(right),
            ),
            competitors: gaps.map((gap) => gap.name),
          },
        },
      ];
    })
    .sort(
      (left, right) => right.weight - left.weight || left.row.text.localeCompare(right.row.text),
    )
    .map(({ row }) => row);
}
