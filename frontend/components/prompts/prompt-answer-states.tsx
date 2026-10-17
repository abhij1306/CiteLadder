'use client';

import { ProjectLink } from '@/components/layout/scoped-link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { Stack } from '@/components/ui/layout';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses, MetricGroup, MetricItem } from '@/components/ui/workspace';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { agentHandoffHref } from '@/lib/agent/handoff';
import type { PromptMetricItem } from '@/lib/api/types';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayDate, pluralCount } from '@/lib/format';
import { ANSWER_STATES, competitorGaps } from '@/lib/prompts/history';
import { engineLabel } from '@/lib/providers/catalog';

/**
 * Mentions and citations for one prompt in the latest run that measured it:
 * each answer in one of four states, which engines answered, the competitors
 * named where the brand was not, and the hand-off to the prompt's Action.
 */
export function PromptAnswerStates({ latest }: Readonly<{ latest: PromptMetricItem | null }>) {
  const timeZone = useDisplayTimeZone();
  const actionId = latest?.action_id ?? null;
  return (
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
  );
}

function ActionHandoff({ actionId }: Readonly<{ actionId: string }>) {
  return (
    <>
      <Button asChild variant="secondary" size="sm">
        <ProjectLink href={`/agent/actions/${actionId}`}>Open the Action</ProjectLink>
      </Button>
      <Button asChild size="sm">
        <ProjectLink href={agentHandoffHref({ actionId })}>Work on this</ProjectLink>
      </Button>
    </>
  );
}

function LatestRun({ latest }: Readonly<{ latest: PromptMetricItem }>) {
  const counts = latest.counts;
  const states = latest.answer_states ?? null;
  const outcomes = latest.outcomes ?? [];
  const gaps = competitorGaps(outcomes);
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
        <MetricGroup aria-label="Answers by state">
          {ANSWER_STATES.map((state) => (
            <MetricItem
              key={state.key}
              label={state.label}
              value={states[state.key]}
              detail={state.meaning}
            />
          ))}
        </MetricGroup>
      ) : (
        <InlineEmpty>
          No answer succeeded for this prompt in that run, so mentions and citations are unavailable
          rather than zero.
        </InlineEmpty>
      )}
      {outcomes.length ? <EngineTable outcomes={outcomes} /> : null}
      <Stack gap="compact">
        <h3 className={textRole('sectionTitle')}>Competitors named without you</h3>
        {gaps.length ? (
          <ul className={ledgerClasses('boxed')}>
            {gaps.map((gap) => (
              <li
                key={gap.name}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <span className={textRole('itemTitle')}>{gap.name}</span>
                <span className="type-caption">
                  {pluralCount(gap.answers, 'answer')} on {gap.engines.map(engineLabel).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-caption">
            {states
              ? 'No answer named a tracked competitor while leaving you out.'
              : 'Unavailable until an answer succeeds.'}
          </p>
        )}
      </Stack>
    </Stack>
  );
}

type Outcome = NonNullable<PromptMetricItem['outcomes']>[number];

/** Engine coverage: each engine and model that answered, by answer state. */
function EngineTable({ outcomes }: Readonly<{ outcomes: readonly Outcome[] }>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Engine</TableHead>
          <TableHead numeric>Answers</TableHead>
          {ANSWER_STATES.map((state) => (
            <TableHead key={state.key} numeric>
              {state.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
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
      </TableBody>
    </Table>
  );
}
