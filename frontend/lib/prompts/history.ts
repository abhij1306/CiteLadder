import type { AnswerStates } from '@citeladder/contracts/visibility';

import type { TrendEvent, TrendPoint } from '@/components/ui/series-data';
import type { PromptHistory, PromptMetricItem } from '@citeladder/contracts';
import { formatDisplayDate, formatDisplayShortDate, formattedText } from '@/lib/format';
import { formatWholePercent } from '@/lib/visibility/dashboard';

type HistoryPoint = PromptHistory['points'][number];
type Outcome = NonNullable<PromptMetricItem['outcomes']>[number];

export function promptHistoryHref(promptId: string): `/${string}` {
  return `/prompts/${encodeURIComponent(promptId)}`;
}

const percent = (rate: number | null) => (rate === null ? null : rate * 100);

export function mentionRatePoints(points: readonly HistoryPoint[], timeZone: string): TrendPoint[] {
  return points.map((point) => {
    const value = percent(point.mention_rate);
    return {
      label: `${formatDisplayDate(point.completed_at, timeZone)} · ${formattedText(formatWholePercent(value))}`,
      axisLabel: formatDisplayShortDate(point.completed_at, timeZone),
      value,
      timestamp: new Date(point.completed_at).getTime(),
      breakBefore: point.comparable_with_previous === false,
    };
  });
}

export function ownedCitationValues(points: readonly HistoryPoint[]): (number | null)[] {
  return points.map((point) => percent(point.owned_citation_rate));
}

export function implementationEvents(
  implementations: PromptHistory['implementations'],
  timeZone: string,
): TrendEvent[] {
  return implementations.map((item) => ({
    key: `${item.action_id}:${item.implemented_at}`,
    timestamp: new Date(item.implemented_at).getTime(),
    kind: 'action',
    label: `Marked implemented ${formatDisplayDate(item.implemented_at, timeZone)}: ${item.title}`,
  }));
}

export const ANSWER_STATES = [
  { key: 'mentioned_and_cited', label: 'Mentioned and cited' },
  { key: 'mentioned_only', label: 'Mentioned only' },
  { key: 'cited_only', label: 'Cited only' },
  { key: 'neither', label: 'Neither' },
] as const satisfies readonly { key: keyof AnswerStates; label: string }[];

type CompetitorGap = { name: string; answers: number; engines: string[] };

function competitorGaps(outcomes: readonly Outcome[]): CompetitorGap[] {
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

export type MissingPrompt = {
  promptId: string;
  text: string;
  actionId: string | null;
  engines: string[];
  competitors: string[];
};

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
