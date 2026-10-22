'use client';

import { ProjectLink } from '@/components/layout/scoped-link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { StatRow } from '@/components/ui/stat-row';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { agentHandoffHref } from '@/lib/agent/handoff';
import type { PromptMetricItem } from '@/lib/api/types';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayDate, pluralCount } from '@/lib/format';
import { ANSWER_STATES, competitorGaps, type CompetitorGap } from '@/lib/prompts/history';
import { engineLabel } from '@/lib/providers/catalog';

/**
 * Mentions and citations for one prompt in the latest run that measured it:
 * each answer in one of four states, which engines answered, the competitors
 * named where the brand was not, and the hand-off to the prompt's Action.
 */
export function PromptAnswerStates({ latest }: Readonly<{ latest: PromptMetricItem | null }>) {
  const timeZone = useDisplayTimeZone();
  const actionId = latest?.action_id ?? null;
  const outcomes = latest?.outcomes ?? [];
  const gaps = competitorGaps(outcomes);
  return (
    <>
      <Card>
        <CardHeader actions={actionId ? <ActionHandoff actionId={actionId} /> : null}>
          <CardTitle>Mentions and citations</CardTitle>
          <CardDescription>
            {latest
              ? `Latest run that measured this prompt, ${formatDisplayDate(latest.created_at, timeZone)}.`
              : 'No run has measured this prompt in this market yet.'}
          </CardDescription>
        </CardHeader>
        {latest ? (
          <CardContent>
            <LatestRun latest={latest} />
          </CardContent>
        ) : null}
      </Card>
      {outcomes.length ? <EngineTable outcomes={outcomes} /> : null}
      {gaps.length ? <CompetitorGapTable gaps={gaps} /> : null}
    </>
  );
}

function ActionHandoff({ actionId }: Readonly<{ actionId: string }>) {
  return (
    <>
      <Button asChild variant="secondary">
        <ProjectLink href={`/agent/actions/${actionId}`}>Open the Action</ProjectLink>
      </Button>
      <Button asChild>
        <ProjectLink href={agentHandoffHref({ actionId })}>Work on this</ProjectLink>
      </Button>
    </>
  );
}

function LatestRun({ latest }: Readonly<{ latest: PromptMetricItem }>) {
  const counts = latest.counts;
  const states = latest.answer_states ?? null;
  const outcomes = latest.outcomes ?? [];
  return (
    <Stack gap="workspace">
      {counts ? (
        <p className="type-caption">
          {counts.responses} of {counts.expected ?? counts.responses} answers succeeded across{' '}
          {pluralCount(outcomes.length, 'engine')}
          {counts.failed ? `; ${counts.failed} failed` : ''}
          {counts.not_run ? `; ${counts.not_run} not run` : ''}.{' '}
          <TextLink href={`/runs/${latest.audit_id}`}>Read the answers</TextLink>
        </p>
      ) : null}
      {states ? (
        <StatRow
          label="Answers by state"
          segments={ANSWER_STATES.map((state) => ({
            key: state.key,
            label: state.label,
            value: states[state.key],
            sub: state.meaning,
          }))}
        />
      ) : (
        <QueryState
          kind="empty"
          inline
          message="No answer succeeded for this prompt in that run, so mentions and citations are unavailable rather than zero."
        />
      )}
      {/* Only a measured, empty gap list is "none"; absent outcomes are unavailable. */}
      {states && latest.outcomes && competitorGaps(latest.outcomes).length === 0 ? (
        <QueryState
          kind="empty"
          inline
          message="No answer named a tracked competitor while leaving you out."
        />
      ) : null}
    </Stack>
  );
}

const GAP_COLUMNS: readonly DataTableColumn[] = [
  { key: 'competitor', label: 'Competitor' },
  { key: 'answers', label: 'Answers', width: 'figure', numeric: true },
  { key: 'engines', label: 'Engines', width: 'name' },
];

/** Competitors named where the brand was not, most answers first. */
function CompetitorGapTable({ gaps }: Readonly<{ gaps: readonly CompetitorGap[] }>) {
  return (
    <DataTable title="Competitors named without you" columns={GAP_COLUMNS}>
      {gaps.map((gap) => (
        <TableRow key={gap.name}>
          <TableCell>
            <ClampText lines={1}>{gap.name}</ClampText>
          </TableCell>
          <TableCell numeric>{gap.answers}</TableCell>
          <TableCell>{gap.engines.map(engineLabel).join(', ')}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

type Outcome = NonNullable<PromptMetricItem['outcomes']>[number];

/** Engine coverage: each engine and model that answered, by answer state. */
// The engine leads at a quarter of the table, so "Google AI Overview" holds
// one line at every width; the five counts share the rest evenly.
const ENGINE_COLUMNS: readonly DataTableColumn[] = [
  { key: 'engine', label: 'Engine', width: 'lead' },
  { key: 'answers', label: 'Answers', numeric: true },
  ...ANSWER_STATES.map((state): DataTableColumn => ({
    key: state.key,
    label: state.label,
    numeric: true,
  })),
];

function EngineTable({ outcomes }: Readonly<{ outcomes: readonly Outcome[] }>) {
  return (
    <DataTable title="Engine coverage" columns={ENGINE_COLUMNS}>
      {outcomes.map((outcome) => (
        <TableRow key={`${outcome.logical_engine}:${outcome.transport_model}`}>
          <TableCell>{engineLabel(outcome.logical_engine)}</TableCell>
          <TableCell numeric>{outcome.counts.responses}</TableCell>
          {ANSWER_STATES.map((state) => (
            <TableCell key={state.key} numeric>
              {outcome.answer_states ? (
                outcome.answer_states[state.key]
              ) : (
                <UnavailableValue state="not_measured" />
              )}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </DataTable>
  );
}
