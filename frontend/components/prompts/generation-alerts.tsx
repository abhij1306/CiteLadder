import { Alert } from '@/components/ui/alert';
import { httpErrorStatus, humanizeApiError } from '@/lib/api/errors';
import type { PromptGenerateResponse } from '@/lib/api/types';
import { admissionDropSummary } from '@/lib/prompts/admission';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const SHORTFALL: Record<NonNullable<PromptGenerateResponse['shortfall_reason']>, string> = {
  deadline: 'Drafting stopped at the time limit; generate again for more.',
  model_error: 'The AI provider failed partway, so the set is smaller; generate again for more.',
};

/** What a run drafted, and why it fell short of the request when it did. */
export function GenerateResultAlert({ result }: Readonly<{ result: PromptGenerateResponse }>) {
  const total = result.candidates.length;
  const topicCount = new Set(
    result.candidates
      .map((candidate) => candidate.topic_id)
      .filter((id): id is string => id != null),
  ).size;
  const duplicates = result.dropped_duplicates
    ? `; ${plural(result.dropped_duplicates, 'duplicate')} skipped`
    : '';
  const gated = result.quality_rejected
    ? `; ${plural(result.quality_rejected, 'weak suggestion')} removed by quality checks`
    : '';
  // Say so when the request could not be filled, rather than letting a short
  // set read as the number that was asked for.
  const shortfall =
    result.requested_count > total ? ` (${total} of ${result.requested_count} requested)` : '';
  const drops = admissionDropSummary(result.admission_drops, ['duplicate']);
  const stopped = result.shortfall_reason ? ` ${SHORTFALL[result.shortfall_reason]}` : '';
  const judge =
    result.quality_gate === 'unavailable'
      ? ' Quality checks may have been unavailable for some suggestions, so an unflagged row may not have been checked.'
      : '';
  return (
    <Alert tone={result.quality_gate === 'unavailable' || stopped ? 'warning' : 'info'}>
      Drafted {plural(total, 'suggestion')}
      {shortfall}
      {topicCount ? ` across ${plural(topicCount, 'topic')}` : ''}
      {duplicates}
      {gated}. Accept the ones worth tracking.{drops ? ` ${drops}` : ''}
      {stopped}
      {judge}
    </Alert>
  );
}

/** A failed model action (generation or a topic proposal), in customer terms. */
export function GenerateErrorAlert({
  error,
  fallback = 'Generation failed. Please try again.',
}: Readonly<{ error: unknown; fallback?: string }>) {
  const status = httpErrorStatus(error);
  if (status === 429) {
    const retryAfter = humanizeApiError(error).retryAfterSeconds;
    return (
      <Alert tone="warning">
        The AI provider is rate limited. Try again
        {retryAfter ? ` in about ${retryAfter} seconds` : ' in a moment'}.
      </Alert>
    );
  }
  if (status === 503) {
    return (
      <Alert tone="warning">Prompt generation isn&apos;t available on this deployment yet.</Alert>
    );
  }
  if (status === 502)
    return (
      <Alert tone="danger">
        The AI provider call failed or returned unusable output. Try again in a moment.
      </Alert>
    );
  return (
    <Alert tone="danger">
      {error instanceof Error && error.message ? error.message : fallback}
    </Alert>
  );
}
