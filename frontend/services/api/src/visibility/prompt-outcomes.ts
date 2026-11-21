import type {
  AnswerStates,
  measurementCountsSchema,
  promptMetricItemSchema,
} from '@citeladder/contracts/visibility';
import type { z } from 'zod';

import { policy } from '../config.ts';
import { record, strings } from '../db/json.ts';
import { answerCounts, answerRates } from '../analysis/aggregate.ts';

const { succeeded: SUCCEEDED, failed: FAILED } = policy.task_queue.statuses;

export type Counts = z.input<typeof measurementCountsSchema>;
type Outcome = NonNullable<z.input<typeof promptMetricItemSchema>['outcomes']>[number];

export function emptyCounts(): Counts {
  return {
    state: 'unavailable',
    responses: 0,
    brand_responses: null,
    owned_citation_responses: null,
    entity_presences: null,
    expected: null,
    failed: null,
    not_run: null,
  };
}

type Response = {
  logical_engine: string;
  transport_model: string;
  brand_mentioned: boolean;
  owned_domain_cited: boolean;
  avg_position: number | null;
  score: unknown;
};
type Task = { status: string; logical_engine: string; transport_model: string };

export function answerStates(
  responses: readonly Pick<Response, 'brand_mentioned' | 'owned_domain_cited'>[],
): AnswerStates | null {
  if (responses.length === 0) return null;
  const count = (mentioned: boolean, cited: boolean) =>
    responses.filter((row) => row.brand_mentioned === mentioned && row.owned_domain_cited === cited)
      .length;
  return {
    mentioned_and_cited: count(true, true),
    mentioned_only: count(true, false),
    cited_only: count(false, true),
    neither: count(false, false),
  };
}

export function poolStates(
  parts: readonly (AnswerStates | null | undefined)[],
): AnswerStates | null {
  const present = parts.filter((part) => part != null);
  if (present.length === 0) return null;
  const total = (key: keyof AnswerStates) => present.reduce((sum, part) => sum + part[key], 0);
  return {
    mentioned_and_cited: total('mentioned_and_cited'),
    mentioned_only: total('mentioned_only'),
    cited_only: total('cited_only'),
    neither: total('neither'),
  };
}

export function countRates(
  counts: Pick<Counts, 'responses' | 'brand_responses' | 'owned_citation_responses'>,
) {
  const rates = answerRates({
    answers: counts.responses,
    mentioned: counts.brand_responses,
    cited: counts.owned_citation_responses,
  });
  return {
    visibility_rate: rates.brand_mention_rate,
    owned_citation_rate: rates.owned_citation_rate,
  };
}

export function outcomeCounts(
  responses: readonly Pick<Response, 'brand_mentioned' | 'owned_domain_cited'>[],
  tasks: readonly Pick<Task, 'status'>[],
): Counts {
  const answered = answerCounts(responses);
  return {
    state: responses.length ? 'measured' : 'no_observations',
    responses: responses.length,
    expected: tasks.length,
    failed: tasks.filter((task) => task.status === FAILED).length,
    not_run: tasks.filter((task) => task.status !== SUCCEEDED && task.status !== FAILED).length,
    brand_responses: answered.mentioned,
    owned_citation_responses: answered.cited,
    entity_presences: null,
  };
}

export function outcome(
  engine: string,
  model: string,
  responses: Response[],
  tasks: Task[],
): Outcome {
  const counts = outcomeCounts(responses, tasks);
  const gaps: Record<string, number> = {};
  for (const row of responses) {
    if (row.brand_mentioned) continue;
    for (const name of strings(record(row.score).competitors_mentioned)) {
      gaps[name] = (gaps[name] ?? 0) + 1;
    }
  }
  return {
    logical_engine: engine,
    transport_model: model,
    counts,
    ...countRates(counts),
    answer_states: answerStates(responses),
    gap_counts: gaps,
  };
}
