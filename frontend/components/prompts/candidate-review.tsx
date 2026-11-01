'use client';

import { Check, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Icon } from '@/components/ui/icon';
import { InfoHint } from '@/components/ui/info-hint';
import { Inline, Stack } from '@/components/ui/layout';
import { TableCell, TableCellLines, TableRow, TableSelectCell } from '@/components/ui/table';
import { Tag } from '@/components/ui/tag';
import type { PromptCandidate, Topic } from '@/lib/api/types';
import { qualityFlagLabel, qualityStatusLabel } from '@/lib/prompts/candidate-quality';
import type { usePromptCandidates } from '@/lib/prompts/use-prompt-candidates';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'suggestion', label: 'Suggestion' },
  { key: 'checks', label: 'Checks', width: 'name' },
];

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
    <Stack gap="compact" className="min-w-0">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <DataTable
        nested
        title={`Review ${plural(candidates.length, 'suggestion')}`}
        toolbar={{
          status: <span className="type-caption tabular-nums">{selected.length} selected</span>,
          actions: (
            <>
              <Button
                variant="ghost"
                onClick={() => review(onReject)}
                disabled={isReviewing || selected.length === 0}
              >
                <Icon icon={X} />
                Reject selected
              </Button>
              <Button
                variant="primary"
                onClick={() => review(onAccept)}
                disabled={isReviewing || selected.length === 0}
              >
                <Icon icon={Check} />
                Accept selected
              </Button>
            </>
          ),
        }}
        selection={{
          all: allState,
          onAllChange: (checked) =>
            setPicked(checked ? new Set(candidates.map((c) => c.id)) : new Set()),
          noun: 'suggestions',
        }}
        columns={COLUMNS}
        rowLines={2}
      >
        {candidates.map((candidate) => {
          const topicName = candidate.topic_id ? topicNames.get(candidate.topic_id) : undefined;
          const statusId = `${descriptionId}-${candidate.id}`;
          return (
            <TableRow key={candidate.id}>
              <TableSelectCell
                label={`Select “${candidate.text}”`}
                describedBy={statusId}
                checked={picked.has(candidate.id)}
                onCheckedChange={(checked) => toggle(candidate.id, checked)}
                disabled={isReviewing}
              />
              <TableCell>
                <TableCellLines
                  primary={candidate.text}
                  secondary={
                    <>
                      {topicName ? `${topicName} · ` : null}
                      <span id={statusId}>{qualityStatusLabel(candidate)}</span>
                    </>
                  }
                />
              </TableCell>
              <TableCell>
                <Inline as="span" gap="tight">
                  {candidate.grounded ? (
                    <>
                      <Tag>Informed by your search data</Tag>
                      <InfoHint label="About search data">
                        Phrasing was guided by queries from your connected Search Console or keyword
                        research. The prompt itself was written for AI assistants.
                      </InfoHint>
                    </>
                  ) : null}
                  {candidate.quality_flags.map((flag) => (
                    <Badge key={flag} variant="status" value="warning">
                      {qualityFlagLabel(flag)}
                    </Badge>
                  ))}
                </Inline>
              </TableCell>
            </TableRow>
          );
        })}
      </DataTable>
    </Stack>
  );
}

/** The review list for the Prompt Builder, bound to the candidates hook. */
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
        No pending suggestions remain. They may have expired or already been reviewed. Use Adjust
        run to generate a new batch.
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

/** Library prompt that suggestions are waiting, while the Prompt Builder is closed. */
export function PendingReviewNotice({
  count,
  hidden,
  onReview,
}: Readonly<{ count: number; hidden: boolean; onReview: () => void }>) {
  if (!count || hidden) return null;
  return (
    <Alert tone="info">
      <Inline as="span" className="flex-wrap justify-between">
        {count === 1
          ? '1 generated prompt is waiting for review.'
          : `${count} generated prompts are waiting for review.`}
        <Button variant="secondary" onClick={onReview}>
          Review suggestions
        </Button>
      </Inline>
    </Alert>
  );
}
