import { Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { httpErrorStatus, humanizeApiError } from '@/lib/api/errors';
import type { PromptGenerateResponse, Topic } from '@/lib/api/types';
import { admissionDropSummary } from '@/lib/prompts/admission';
import { orderTopicsForRail } from '@/lib/prompts/topic-tree';
import { textRole } from '@/components/ui/typography';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const SHORTFALL: Record<NonNullable<PromptGenerateResponse['shortfall_reason']>, string> = {
  deadline: 'Drafting stopped at the time limit; generate again for more.',
  model_error: 'The AI provider failed partway, so the set is smaller; generate again for more.',
};

function GenerateResultAlert({ result }: Readonly<{ result: PromptGenerateResponse }>) {
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

function GenerateErrorAlert({ error }: Readonly<{ error: unknown }>) {
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
      {error instanceof Error && error.message
        ? error.message
        : 'Generation failed. Please try again.'}
    </Alert>
  );
}

function useGenerationStep(open: boolean, result?: PromptGenerateResponse | null) {
  const [showSetup, setShowSetup] = useState(false);
  const [previousResult, setPreviousResult] = useState(result);
  const [previousOpen, setPreviousOpen] = useState(open);
  if (previousOpen !== open) {
    setPreviousOpen(open);
    if (open) setShowSetup(false);
  }
  // Only a new result returns to review; clearing it for Generate more must not.
  if (previousResult !== result) {
    setPreviousResult(result);
    if (result) setShowSetup(false);
  }
  return [showSetup, setShowSetup] as const;
}

function GenerationFooter({
  reviewing,
  hasResult,
  onClose,
  onMore,
  onSubmit,
  isGenerating,
  countValid,
}: Readonly<{
  reviewing: boolean;
  hasResult: boolean;
  onClose: () => void;
  onMore: () => void;
  onSubmit: () => void;
  isGenerating?: boolean;
  countValid: boolean;
}>) {
  return (
    <>
      <Button variant="ghost" onClick={onClose}>
        {reviewing || hasResult ? 'Close' : 'Cancel'}
      </Button>
      {reviewing ? (
        <Button variant="secondary" onClick={onMore}>
          Generate more
        </Button>
      ) : (
        <Button variant="primary" onClick={onSubmit} disabled={isGenerating || !countValid}>
          <Sparkles className="size-4" aria-hidden />
          {isGenerating ? 'Generating…' : 'Generate'}
        </Button>
      )}
    </>
  );
}

export function GeneratePromptsDialogView({
  open,
  onOpenChange,
  topics,
  count,
  selectedTopicIds,
  setCount,
  toggleTopic,
  countValid,
  onSubmit,
  isGenerating,
  error,
  result,
  maxCount,
  review,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topics: Topic[];
  count: string;
  /** Selected topics; empty means every topic. */
  selectedTopicIds: ReadonlySet<string>;
  setCount: (value: string) => void;
  toggleTopic: (id: string, checked: boolean) => void;
  countValid: boolean;
  onSubmit: () => void;
  isGenerating?: boolean;
  error?: unknown;
  result?: PromptGenerateResponse | null;
  maxCount: number;
  /** The pending-candidate review list, when there is anything to review. */
  review?: ReactNode;
}>) {
  const [showSetup, setShowSetup] = useGenerationStep(open, result);
  const reviewing = Boolean(review) && !showSetup;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={reviewing ? 'Review suggested questions' : 'Generate prompts'}
      description={
        reviewing
          ? 'Choose the questions your buyers would actually ask. Only accepted questions enter your tracked library.'
          : 'Draft distinct buying questions across your offerings and buying stages, then choose what to track. To target a place, persona or niche, use Build with Agent.'
      }
      className={reviewing ? 'w-200' : 'w-130'}
      footer={
        <GenerationFooter
          reviewing={reviewing}
          hasResult={Boolean(result)}
          onClose={() => onOpenChange(false)}
          onMore={() => setShowSetup(true)}
          onSubmit={onSubmit}
          isGenerating={isGenerating}
          countValid={countValid}
        />
      }
    >
      <div className="grid gap-4">
        {isGenerating ? (
          <Alert tone="info">
            Writing and quality-checking questions can take a minute or two. Keep this open.
          </Alert>
        ) : null}
        {error ? <GenerateErrorAlert error={error} /> : null}
        {result && !error ? <GenerateResultAlert result={result} /> : null}
        {reviewing ? (
          review
        ) : (
          <>
            <div className="grid gap-2">
              <span className={textRole('label')}>Number of prompts (1–{maxCount})</span>
              <Input
                type="number"
                min={1}
                max={maxCount}
                value={count}
                onChange={(event) => setCount(event.target.value)}
                aria-label="Number of prompts"
                aria-invalid={!countValid}
              />
            </div>
            {topics.length > 0 ? (
              <fieldset className="grid min-w-0 gap-2">
                <legend className={textRole('label')}>Topics</legend>
                <span className="type-caption">
                  {selectedTopicIds.size
                    ? `${plural(selectedTopicIds.size, 'topic')} selected.`
                    : 'None selected: suggestions cover every topic.'}
                </span>
                <div className="grid max-h-48 min-w-0 overflow-y-auto">
                  {orderTopicsForRail(topics).map(({ topic, nested }) => (
                    <Checkbox
                      key={topic.id}
                      label={topic.name}
                      className={nested ? 'ms-6' : undefined}
                      checked={selectedTopicIds.has(topic.id)}
                      onCheckedChange={(checked) => toggleTopic(topic.id, checked === true)}
                      disabled={isGenerating}
                    />
                  ))}
                </div>
              </fieldset>
            ) : (
              <Alert tone="info">
                No topics exist yet. CiteLadder will create them from your confirmed offerings, then
                generate prompts.
              </Alert>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
