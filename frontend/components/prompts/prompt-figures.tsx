import type { ReactNode } from 'react';

import { Absence } from '@/components/ui/absence';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Delta } from '@/components/ui/delta';
import { EngineMark, engineMarkKey } from '@/components/ui/engine-mark';
import { FigureStrip, type FigureSegment } from '@/components/ui/figure-strip';
import { Inline } from '@/components/ui/layout';
import { TableCell, TableRow } from '@/components/ui/table';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatCount, formatDisplayDate, formatMean, formatPercent } from '@/lib/format';
import { ANSWER_STATES } from '@/lib/prompts/history';
import { useEngineCatalog } from '@/lib/providers/engines';
import type { AnswerStates, PromptHistory, PromptMetricItem } from '@citeladder/contracts';

export const NOT_MEASURED = <Absence state="not_measured" />;

export const NO_ANSWERS = <Absence state="unavailable" label="No answers" />;

export function positionAbsence(visibility: number | null): ReactNode {
  if (visibility === null) return NO_ANSWERS;
  if (visibility === 0) return <Absence state="none" label="Not named" />;
  return <Absence state="unavailable" reason="These answers' brand order was not recorded." />;
}

export function PromptKeyFigures({ history }: Readonly<{ history: PromptHistory }>) {
  const timeZone = useDisplayTimeZone();
  const point = history.points.at(-1);
  const latest = history.latest;
  const baselineAt = latest?.comparison?.baseline_at ?? null;
  const delta = latest?.visibility_delta;
  const runDate = point ? `Latest run ${formatDisplayDate(point.completed_at, timeZone)}` : null;
  const states = latest?.answer_states ?? null;
  const segments: FigureSegment[] = [
    {
      key: 'visibility',
      label: 'Visibility',
      value: rateValue(point?.mention_rate, point ? NO_ANSWERS : NOT_MEASURED),
      ...(delta == null ? {} : { delta: <Delta value={delta} unit=" pp" /> }),
      sub: [runDate, baselineAt ? `vs ${formatDisplayDate(baselineAt, timeZone)}` : null]
        .filter(Boolean)
        .join(' · '),
    },
    {
      key: 'owned',
      label: 'Owned citation rate',
      value: rateValue(
        point?.owned_citation_rate,
        point?.counts.responses === 0 ? NO_ANSWERS : NOT_MEASURED,
      ),
    },
    {
      key: 'position',
      label: 'Position',
      value: <PositionValue latest={latest} visibility={point?.mention_rate ?? null} />,
    },
    {
      key: BOTH.key,
      label: BOTH.label,
      value: stateValue(states, BOTH.key, latest),
      sub: otherStates(states, latest),
    },
  ];
  return <FigureStrip label="Latest measurement" segments={segments} />;
}

const [BOTH, ...OTHER_STATES] = ANSWER_STATES;

function otherStates(states: AnswerStates | null, latest: PromptMetricItem | null): string {
  const missing = latest ? 'no answers' : 'not measured';
  const parts = OTHER_STATES.map(
    (state) => `${state.label}: ${states ? formatCount(states[state.key]) : missing}`,
  );
  return parts.join(' · ');
}

function rateValue(rate: number | null | undefined, missing: ReactNode) {
  return rate == null ? missing : formatPercent(rate);
}

function stateValue(
  states: AnswerStates | null,
  key: keyof AnswerStates,
  latest: PromptMetricItem | null,
) {
  if (states) return formatCount(states[key]);
  return latest ? NO_ANSWERS : NOT_MEASURED;
}

function PositionValue({
  latest,
  visibility,
}: Readonly<{ latest: PromptMetricItem | null; visibility: number | null }>) {
  if (!latest) return NOT_MEASURED;
  if (latest.avg_position != null) return formatMean(latest.avg_position);
  return positionAbsence(visibility);
}

type Outcome = NonNullable<PromptMetricItem['outcomes']>[number];

const ENGINE_COLUMNS: readonly DataTableColumn[] = [
  { key: 'engine', label: 'Engine', kind: 'identity' },
  {
    key: 'answered',
    label: 'Answered',
    width: 'figure',
    kind: 'number',
    hint: 'Answers that succeeded, of the answers the run asked for.',
  },
  {
    key: 'mentioned',
    label: 'Mentioned',
    width: 'figure',
    kind: 'number',
  },
  {
    key: 'cited',
    label: 'Cited',
    width: 'figure',
    kind: 'number',
  },
];

export function PromptEngineCoverage({ latest }: Readonly<{ latest: PromptMetricItem | null }>) {
  const engines = useEngineCatalog();
  const outcomes = latest?.outcomes ?? [];
  if (!outcomes.length) return null;
  return (
    <DataTable title="Engine coverage" columns={ENGINE_COLUMNS}>
      {outcomes.map((outcome) => {
        const mark = engineMarkKey(outcome.logical_engine);
        return (
          <TableRow key={outcome.logical_engine}>
            <TableCell>
              <Inline gap="item">
                {mark ? <EngineMark engine={mark} /> : null}
                {engines.label(outcome.logical_engine)}
              </Inline>
            </TableCell>
            <TableCell numeric>{answered(outcome)}</TableCell>
            <TableCell numeric>
              <StateSum outcome={outcome} keys={['mentioned_and_cited', 'mentioned_only']} />
            </TableCell>
            <TableCell numeric>
              <StateSum outcome={outcome} keys={['mentioned_and_cited', 'cited_only']} />
            </TableCell>
          </TableRow>
        );
      })}
    </DataTable>
  );
}

function answered({ counts }: Outcome): ReactNode {
  if (counts.expected === null)
    return (
      <>
        {formatCount(counts.responses)}/
        <Absence state="unavailable" label="Asked count not recorded" />
      </>
    );
  return `${formatCount(counts.responses)}/${formatCount(counts.expected)}`;
}

function StateSum({
  outcome,
  keys,
}: Readonly<{ outcome: Outcome; keys: readonly (keyof AnswerStates)[] }>) {
  const states = outcome.answer_states;
  if (!states) return <Absence state="unavailable" label="No answer" />;
  return formatCount(keys.reduce((total, key) => total + states[key], 0));
}
