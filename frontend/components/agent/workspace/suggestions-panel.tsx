import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { JUMP_LINK } from '@/components/agent/jump-link';

import { GapEvidence, type GapMember } from '@/components/agent/content-gap-evidence';
import { StatusMark } from '@/components/ui/status-mark';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { Pressable } from '@/components/ui/pressable';
import { SegmentedControl } from '@/components/ui/tabs';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { X } from '@/lib/icons';
import { agentWriteFailure, isOutputConflict } from '@/lib/agent/errors';
import { groupByPassage } from '@/lib/agent/page-workspace';
import {
  PAGE_CHANGED_COPY,
  suggestionCategoryLabel,
  suggestionStaleCopy,
  suggestionStrengthCopy,
} from '@/lib/agent/vocabulary';
import {
  agentMutations,
  type AgentSuggestion,
  type AgentSuggestionsPage,
  type SuggestionChange,
} from '@/lib/api/agent';
import { pluralCount } from '@/lib/format';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { Notice, type NoticeTone } from '@/components/ui/notice';
import { wellClasses } from '@/components/ui/slip';
import { DraftSheet, type DraftState } from '@/components/ui/draft-sheet';

type Filter = 'open' | 'applied' | 'dismissed';
type Notice = { tone: NoticeTone; message: string };
export type ContextReference = Readonly<{ quote: string; request: string }>;

const suggestionCardId = (id: string) => `suggestion-${id}`;

function failureNotice(error: unknown, action: string): Notice {
  if (isOutputConflict(error)) return { tone: 'warning', message: PAGE_CHANGED_COPY };
  return { tone: 'negative', message: agentWriteFailure(error, action).message };
}

const REVERTED = 'Back in To review.';

function changeNotice(outcome: string, reason: string | null): Notice | null {
  if (outcome === 'stale') return { tone: 'warning', message: suggestionStaleCopy(reason) };
  return outcome === 'reverted' ? { tone: 'info', message: REVERTED } : null;
}

function appliedNotice(result: {
  applied: number;
  left_to_choose: number;
  needs_input: number;
  stale: number;
}): Notice {
  const parts = [
    result.applied > 0 ? `Applied ${pluralCount(result.applied, 'suggestion')}.` : null,
    result.left_to_choose > 0
      ? `Left ${pluralCount(result.left_to_choose, 'overlapping suggestion')} for you to choose.`
      : null,
    result.needs_input > 0
      ? `Skipped ${pluralCount(result.needs_input, 'suggestion')} that need a fact from you.`
      : null,
    result.stale > 0
      ? `Set aside ${pluralCount(result.stale, 'suggestion')} that no longer fit the page.`
      : null,
  ].filter(Boolean);
  if (parts.length === 0) return { tone: 'info', message: 'Nothing was ready to apply.' };
  return { tone: result.applied > 0 ? 'positive' : 'info', message: parts.join(' ') };
}

function originalText(suggestion: AgentSuggestion): string | null {
  const { anchor } = suggestion;
  if (anchor.kind === 'span') return anchor.quote.exact;
  return anchor.kind === 'field' ? anchor.expected : null;
}

function suggestionReference(suggestion: AgentSuggestion): ContextReference {
  const original = originalText(suggestion);
  return {
    quote: [suggestion.needs_input ?? suggestion.rationale, original ? `On: “${original}”` : null]
      .filter(Boolean)
      .join('\n'),
    request: 'Here is the fact you asked for:',
  };
}

function SuggestionText({ suggestion }: Readonly<{ suggestion: AgentSuggestion }>) {
  const original = originalText(suggestion);
  if (suggestion.readiness === 'needs_input')
    return <span className={textRole('body')}>{suggestion.needs_input}</span>;
  if (suggestion.replacement === null)
    return <span className={textRole('body')}>{suggestion.rationale}</span>;
  return (
    <Stack as="span" gap="tight">
      <span className={textRole('body', '[overflow-wrap:anywhere]')}>
        {suggestion.replacement || 'Remove this text.'}
      </span>
      {original ? (
        <span className={textRole('caption', '[overflow-wrap:anywhere]')}>
          Replaces “{original}”
        </span>
      ) : null}
    </Stack>
  );
}

type Guidance = NonNullable<AgentSuggestion['guidance']>;

function StrengthBadge({ guidance }: Readonly<{ guidance: Guidance | null }>) {
  const badge = guidance ? suggestionStrengthCopy(guidance.strength).badge : null;
  return badge ? <StatusMark tone="neutral">{badge}</StatusMark> : null;
}

function RuleSource({ guidance }: Readonly<{ guidance: Guidance | null }>) {
  if (!guidance) return null;
  return (
    <p className={textRole('caption')}>
      {suggestionStrengthCopy(guidance.strength).lead}{' '}
      <TextLink variant="external" href={guidance.source_url} text="inherit">
        {guidance.source_label}
      </TextLink>
    </p>
  );
}

type CardActions = {
  disabled: boolean;
  onChange: (suggestion: AgentSuggestion, change: SuggestionChange) => void;
  onAddToContext: (reference: ContextReference) => void;
};

function Actions({
  suggestion,
  textId,
  disabled,
  onChange,
  onAddToContext,
}: Readonly<CardActions & { suggestion: AgentSuggestion; textId: string }>) {
  if (suggestion.status !== 'open')
    return (
      <Button
        variant="secondary"
        disabled={disabled}
        aria-describedby={textId}
        onClick={() => onChange(suggestion, 'revert')}
      >
        Revert
      </Button>
    );
  return (
    <Inline className="flex-wrap">
      {suggestion.readiness === 'ready' ? (
        <Button
          variant="primary"
          disabled={disabled}
          aria-describedby={textId}
          onClick={() => onChange(suggestion, 'apply')}
        >
          Apply
        </Button>
      ) : null}
      {suggestion.readiness === 'needs_input' ? (
        <Button
          variant="secondary"
          aria-describedby={textId}
          onClick={() => onAddToContext(suggestionReference(suggestion))}
        >
          Add to context
        </Button>
      ) : null}
      <Button
        variant="quiet"
        disabled={disabled}
        aria-describedby={textId}
        onClick={() => onChange(suggestion, 'dismiss')}
      >
        <Icon icon={X} />
        Dismiss
      </Button>
    </Inline>
  );
}

function SuggestionCard({
  suggestion,
  selected,
  canChange,
  onShow,
  ...actions
}: Readonly<
  CardActions & {
    suggestion: AgentSuggestion;
    selected: boolean;
    canChange: boolean;
    onShow: (id: string) => void;
  }
>) {
  const textId = `${suggestionCardId(suggestion.id)}-text`;
  const inPage = suggestion.status === 'open' && suggestion.position !== null;
  const text = (
    <span id={textId}>
      <SuggestionText suggestion={suggestion} />
    </span>
  );
  return (
    <DraftSheet
      as="li"
      id={suggestionCardId(suggestion.id)}
      aria-current={selected || undefined}
      state={SUGGESTION_STATE[suggestion.status]}
      marker={suggestion.status === 'stale' ? 'Out of date' : undefined}
      className="suggestion-card"
    >
      <Inline className="flex-wrap">
        <StatusMark tone={suggestion.readiness === 'needs_input' ? 'warning' : 'info'}>
          {suggestionCategoryLabel(suggestion.category)}
        </StatusMark>
        <StrengthBadge guidance={suggestion.guidance} />
        {suggestion.readiness === 'needs_input' ? (
          <StatusMark tone="warning">Needs input</StatusMark>
        ) : null}
        {suggestion.choose_one ? <StatusMark tone="neutral">Choose one</StatusMark> : null}
      </Inline>
      {inPage ? (
        <Pressable className={`${JUMP_LINK} text-start`} onClick={() => onShow(suggestion.id)}>
          <span className="sr-only">Show in the page: </span>
          {text}
        </Pressable>
      ) : (
        text
      )}
      {suggestion.readiness !== 'advice' ? (
        <p className={textRole('caption')}>{suggestion.rationale}</p>
      ) : null}
      <RuleSource guidance={suggestion.guidance} />
      {suggestion.choose_one ? (
        <p className={textRole('caption')}>Overlaps another suggestion. Apply all skips it.</p>
      ) : null}
      {canChange ? <Actions suggestion={suggestion} textId={textId} {...actions} /> : null}
    </DraftSheet>
  );
}

const SUGGESTION_STATE: Readonly<Record<AgentSuggestion['status'], DraftState>> = {
  open: 'draft',
  applied: 'accepted',
  dismissed: 'declined',
  stale: 'declined',
};

function CoverageGaps({
  gaps,
  onAddToContext,
}: Readonly<{
  gaps: readonly GapMember[];
  onAddToContext?: (reference: ContextReference) => void;
}>) {
  if (gaps.length === 0) return null;
  return (
    <Stack as="section" gap="compact" aria-labelledby="coverage-gaps">
      <h3 id="coverage-gaps" className={textRole('subheading')}>
        Coverage gaps
      </h3>
      <Stack as="ul" gap="compact">
        {gaps.map(({ id, evidence }) => (
          <Stack as="li" key={id} gap="item" className={wellClasses()}>
            <p className={textRole('body')}>{evidence.angle_label}</p>
            <Disclosure title="Evidence">
              <GapEvidence evidence={evidence} />
            </Disclosure>
            {onAddToContext ? (
              <Button
                variant="secondary"
                className="justify-self-start"
                aria-label={`Add to context: ${evidence.angle_label}`}
                onClick={() =>
                  onAddToContext({
                    quote: `Coverage gap: ${evidence.angle_label}`,
                    request: 'Cover this topic on the page.',
                  })
                }
              >
                Add to context
              </Button>
            ) : null}
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}

function useSuggestionChanges(
  workspaceId: string,
  document: { chatId: string; outputId: string; baseRevisionId: string },
) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const change = useMutation(agentMutations.changeSuggestion(workspaceId));
  const applyAll = useMutation(agentMutations.applyAllSuggestions(workspaceId));
  const dismissAll = useMutation(agentMutations.dismissAllSuggestions(workspaceId));
  const pending = change.isPending || applyAll.isPending || dismissAll.isPending;
  return {
    notice,
    pending,
    change: (suggestion: AgentSuggestion, kind: SuggestionChange) => {
      setNotice(null);
      change.mutate(
        { ...document, suggestionId: suggestion.id, change: kind },
        {
          onSuccess: (result) => setNotice(changeNotice(result.outcome, result.reason)),
          onError: (error) => setNotice(failureNotice(error, 'change the suggestion')),
        },
      );
    },
    applyAll: () => {
      setNotice(null);
      applyAll.mutate(document, {
        onSuccess: (result) => setNotice(appliedNotice(result)),
        onError: (error) => setNotice(failureNotice(error, 'apply the suggestions')),
      });
    },
    dismissAll: () => {
      setNotice(null);
      dismissAll.mutate(document, {
        onSuccess: (result) =>
          setNotice({
            tone: 'info',
            message: `Dismissed ${pluralCount(result.dismissed, 'suggestion')}.`,
          }),
        onError: (error) => setNotice(failureNotice(error, 'dismiss the suggestions')),
      });
    },
  };
}

function BulkActions({
  open,
  ready,
  disabled,
  changes,
}: Readonly<{
  open: number;
  ready: boolean;
  disabled: boolean;
  changes: Pick<ReturnType<typeof useSuggestionChanges>, 'applyAll' | 'dismissAll'>;
}>) {
  if (open === 0) return null;
  return (
    <Inline className="flex-wrap">
      <Button variant="secondary" disabled={disabled || !ready} onClick={changes.applyAll}>
        Apply all
      </Button>
      <Button variant="quiet" disabled={disabled} onClick={changes.dismissAll}>
        <Icon icon={X} />
        Dismiss all
      </Button>
    </Inline>
  );
}

const EMPTY: Readonly<Record<Filter, string>> = {
  open: 'Nothing to review.',
  applied: 'No suggestions applied yet.',
  dismissed: 'No suggestions dismissed.',
};

export function SuggestionsPanel({
  workspaceId,
  target,
  page,
  body,
  locked,
  gaps,
  selectedId,
  onShow,
  onAddToContext,
}: Readonly<{
  workspaceId: string;
  target: { chatId: string; outputId: string; baseRevisionId: string };
  page: AgentSuggestionsPage;
  body: string;
  locked: string | null;
  gaps: readonly GapMember[];
  selectedId: string | null;
  onShow: (id: string) => void;
  onAddToContext: (reference: ContextReference) => void;
}>) {
  const [filter, setFilter] = useState<Filter>('open');
  const [shownSelection, setShownSelection] = useState(selectedId);
  const changes = useSuggestionChanges(workspaceId, target);
  const canChange = useWorkspaceCapability('run');
  if (selectedId !== shownSelection) {
    setShownSelection(selectedId);
    if (selectedId) setFilter('open');
  }
  useEffect(() => {
    if (selectedId)
      document.getElementById(suggestionCardId(selectedId))?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);
  const { counts } = page;
  const items = page.items.filter((suggestion) => suggestion.status === filter);
  const disabled = locked !== null || changes.pending;
  const ready = page.items.some((item) => item.status === 'open' && item.readiness === 'ready');
  return (
    <Stack gap="workspace">
      <SegmentedControl
        ariaLabel="Show suggestions"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'open', label: 'To review', count: counts.open },
          { value: 'applied', label: 'Applied', count: counts.applied },
          { value: 'dismissed', label: 'Dismissed', count: counts.dismissed },
        ]}
      />
      {locked ? <p className={textRole('caption')}>{locked}</p> : null}
      {changes.notice ? <Notice tone={changes.notice.tone}>{changes.notice.message}</Notice> : null}
      {items.length === 0 ? (
        <p className={textRole('body', 'text-ink-2')}>{EMPTY[filter]}</p>
      ) : null}
      {groupByPassage(items, body).map((group) => (
        <Stack as="section" key={group.key} gap="item" aria-label={`Passage: ${group.label}`}>
          <p className={textRole('caption', '[overflow-wrap:anywhere]')}>{group.label}</p>
          <Stack as="ul" gap="compact">
            {group.items.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                selected={suggestion.id === selectedId}
                canChange={canChange}
                disabled={disabled}
                onShow={onShow}
                onChange={changes.change}
                onAddToContext={onAddToContext}
              />
            ))}
          </Stack>
        </Stack>
      ))}
      {canChange && filter === 'open' ? (
        <BulkActions open={counts.open} ready={ready} disabled={disabled} changes={changes} />
      ) : null}
      {counts.stale > 0 ? (
        <p className={textRole('caption')}>
          {pluralCount(counts.stale, 'suggestion')} hidden: no longer fit the page.
        </p>
      ) : null}
      <CoverageGaps gaps={gaps} onAddToContext={canChange ? onAddToContext : undefined} />
    </Stack>
  );
}
