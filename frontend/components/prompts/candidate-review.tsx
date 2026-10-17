'use client';

import { Check, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { InfoHint } from '@/components/ui/info-hint';
import { panelClasses } from '@/components/ui/panel';
import { Tag } from '@/components/ui/tag';
import { textRole } from '@/components/ui/typography';
import type { PromptCandidate, Topic } from '@/lib/api/types';
import { qualityFlagLabel, qualityStatusLabel } from '@/lib/prompts/candidate-quality';
import type { usePromptCandidates } from '@/lib/prompts/use-prompt-candidates';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Generated prompts awaiting review. Only accepted candidates become tracked
 * prompts; rejected ones are deleted. Selection is local and forgets ids that
 * are no longer pending. Rows arrive ranked; quality flags are advisory and
 * never hide a suggestion.
 */
export function CandidateReview({
  candidates,
  topics,
  onAccept,
  onReject,
  isReviewing,
  error,
  notice,
}: Readonly<{
  candidates: PromptCandidate[];
  topics: Topic[];
  onAccept: (ids: string[]) => void;
  onReject: (ids: string[]) => void;
  isReviewing?: boolean;
  error?: string;
  notice?: string | null;
}>) {
  const descriptionId = useId();
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const selected = useMemo(
    () => candidates.filter((candidate) => picked.has(candidate.id)).map((c) => c.id),
    [candidates, picked],
  );
  const topicNames = useMemo(
    () => new Map(topics.map((topic) => [topic.id, topic.name])),
    [topics],
  );

  let allState: boolean | 'indeterminate' = false;
  if (selected.length === candidates.length && candidates.length > 0) allState = true;
  else if (selected.length > 0) allState = 'indeterminate';

  const toggle = (id: string, checked: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  // Reviewed ids leave `candidates` and so drop out of `selected`; a failed
  // request keeps the selection for a retry.
  const review = (action: (ids: string[]) => void) => action(selected);

  return (
    <section aria-labelledby="candidate-review-heading" className="grid min-w-0 gap-3">
      <div className="bg-panel sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 py-2">
        <h3 id="candidate-review-heading" className={textRole('itemTitle')}>
          Review {plural(candidates.length, 'suggestion')}
        </h3>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => review(onReject)}
            disabled={isReviewing || selected.length === 0}
          >
            <X className="size-4" aria-hidden />
            Reject selected
          </Button>
          <Button
            variant="primary"
            onClick={() => review(onAccept)}
            disabled={isReviewing || selected.length === 0}
          >
            <Check className="size-4" aria-hidden />
            Accept selected
          </Button>
        </div>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <div
        className={panelClasses(
          { tone: 'tonal', pad: 'none' },
          'flex items-center justify-between gap-3 px-1 py-1',
        )}
      >
        <Checkbox
          label="Select all"
          checked={allState}
          onCheckedChange={(checked) =>
            setPicked(checked === true ? new Set(candidates.map((c) => c.id)) : new Set())
          }
          disabled={isReviewing}
        />
        <span className="type-caption tabular-nums">{selected.length} selected</span>
      </div>
      <ul className="divide-border grid min-w-0 divide-y" aria-label="Suggested prompts">
        {candidates.map((candidate) => {
          const topicName = candidate.topic_id ? topicNames.get(candidate.topic_id) : undefined;
          return (
            <li key={candidate.id} className="flex min-w-0 items-start gap-2 py-3">
              <Checkbox
                aria-label={`Select “${candidate.text}”`}
                aria-describedby={`${descriptionId}-${candidate.id}`}
                checked={picked.has(candidate.id)}
                onCheckedChange={(checked) => toggle(candidate.id, checked === true)}
                disabled={isReviewing}
              />
              <div className="grid min-w-0 gap-0.5 py-2">
                <span className="type-body text-foreground">{candidate.text}</span>
                {topicName ? <span className="type-caption">{topicName}</span> : null}
                {candidate.grounded ? (
                  <span className="flex items-center gap-1">
                    <Tag>Informed by your search data</Tag>
                    <InfoHint label="About search data">
                      Phrasing was guided by queries from your connected Search Console or keyword
                      research. The prompt itself was written for AI assistants.
                    </InfoHint>
                  </span>
                ) : null}
                <span
                  id={`${descriptionId}-${candidate.id}`}
                  className="type-caption text-secondary"
                >
                  {qualityStatusLabel(candidate)}
                </span>
                {candidate.quality_flags.length ? (
                  <span className="flex flex-wrap gap-1">
                    {candidate.quality_flags.map((flag) => (
                      <Badge key={flag} variant="status" value="warning">
                        {qualityFlagLabel(flag)}
                      </Badge>
                    ))}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The review list for the Generate dialog, bound to the candidates hook. */
export function CandidateReviewPanel({
  review,
  topics,
  setsLoading,
  setsError,
  retrySets,
}: Readonly<{
  review: ReturnType<typeof usePromptCandidates>;
  topics: Topic[];
  setsLoading?: boolean;
  setsError?: boolean;
  retrySets?: () => void;
}>) {
  if (setsLoading || review.isLoading) return <output>Loading suggestions…</output>;
  if (setsError || review.loadError)
    return (
      <Alert tone="danger">
        {review.loadError || 'Could not load prompt sets.'}
        <Button
          variant="secondary"
          onClick={
            setsError
              ? retrySets
              : () => {
                  void review.refresh();
                }
          }
        >
          Retry
        </Button>
      </Alert>
    );
  if (!review.candidates.length && !review.notice)
    return (
      <Alert tone="info">
        No pending suggestions remain. They may have expired or already been reviewed. Use Generate
        more to create a new batch.
      </Alert>
    );
  return (
    <CandidateReview
      candidates={review.candidates}
      topics={topics}
      onAccept={review.accept}
      onReject={review.reject}
      isReviewing={review.isReviewing}
      error={review.error}
      notice={review.notice}
    />
  );
}

/** Library prompt that suggestions are waiting, while the dialog is closed. */
export function PendingReviewNotice({
  count,
  hidden,
  onReview,
}: Readonly<{ count: number; hidden: boolean; onReview: () => void }>) {
  if (!count || hidden) return null;
  return (
    <Alert tone="info">
      <span className="flex flex-wrap items-center justify-between gap-2">
        {count === 1
          ? '1 generated prompt is waiting for review.'
          : `${count} generated prompts are waiting for review.`}
        <Button variant="secondary" onClick={onReview}>
          Review suggestions
        </Button>
      </span>
    </Alert>
  );
}
