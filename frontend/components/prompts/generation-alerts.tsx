import { httpErrorStatus, humanizeApiError } from '@/lib/api/errors';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import type { PromptGenerateResponse } from '@citeladder/contracts';
import { admissionDropSummary } from '@/lib/prompts/admission';
import { Notice } from '@/components/ui/notice';
import { pluralCount } from '@/lib/format';

const SHORTFALL: Record<NonNullable<PromptGenerateResponse['shortfall_reason']>, string> = {
  deadline: 'Drafting stopped at the time limit; generate again for more.',
  model_error: 'The AI provider failed partway, so the set is smaller; generate again for more.',
};

export function GenerateResultAlert({ result }: Readonly<{ result: PromptGenerateResponse }>) {
  const total = result.candidates.length;
  const topicCount = new Set(
    result.candidates
      .map((candidate) => candidate.topic_id)
      .filter((id): id is string => id != null),
  ).size;
  const duplicates = result.dropped_duplicates
    ? `; ${pluralCount(result.dropped_duplicates, 'duplicate')} skipped`
    : '';
  const gated = result.quality_rejected
    ? `; ${pluralCount(result.quality_rejected, 'weak suggestion')} removed by quality checks`
    : '';
  const shortfall =
    result.requested_count > total ? ` (${total} of ${result.requested_count} requested)` : '';
  const drops = admissionDropSummary(result.admission_drops, ['duplicate']);
  const stopped = result.shortfall_reason ? ` ${SHORTFALL[result.shortfall_reason]}` : '';
  const judge =
    result.quality_gate === 'unavailable'
      ? ' Quality checks may have been unavailable for some suggestions, so an unflagged row may not have been checked.'
      : '';
  return (
    <Notice tone={result.quality_gate === 'unavailable' || stopped ? 'warning' : 'info'}>
      Drafted {pluralCount(total, 'suggestion')}
      {shortfall}
      {topicCount ? ` across ${pluralCount(topicCount, 'topic')}` : ''}
      {duplicates}
      {gated}. Accept the ones worth tracking.{drops ? ` ${drops}` : ''}
      {stopped}
      {judge}
    </Notice>
  );
}

export function GenerateErrorAlert({
  error,
  action = 'generate prompts',
}: Readonly<{ error: unknown; action?: string }>) {
  const status = httpErrorStatus(error);
  if (status === 429) {
    const retryAfter = humanizeApiError(error).retryAfterSeconds;
    return (
      <Notice tone="warning">
        The AI provider is rate limited. Try again
        {retryAfter ? ` in about ${retryAfter} seconds` : ' in a moment'}.
      </Notice>
    );
  }
  if (status === 503) {
    return (
      <Notice tone="warning">Prompt generation isn&apos;t available on this deployment yet.</Notice>
    );
  }
  if (status === 502)
    return (
      <Notice tone="negative">
        The AI provider call failed or returned unusable output. Try again in a moment.
      </Notice>
    );
  return <Notice kind="mutation" notice={mutationNoticeForError(error, { action })} />;
}
