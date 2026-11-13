import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { GapEvidence, type GapMember } from '@/components/agent/content-gap-evidence';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout, type CalloutTone } from '@/components/ui/callout';
import { Disclosure } from '@/components/ui/disclosure';
import { Inline, Stack } from '@/components/ui/layout';
import { panelClasses } from '@/components/ui/panel';
import { Pressable } from '@/components/ui/pressable';
import { SegmentedControl } from '@/components/ui/tabs';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
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

type Filter = 'open' | 'applied' | 'dismissed';
type Notice = { tone: CalloutTone; message: string };
/** A reference Add to context writes into the composer. */
export type ContextReference = Readonly<{ quote: string; request: string }>;

/** The card of a suggestion, so a highlight can bring it into view. */
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

/** Apply all's counts as one sentence: what landed, and what was left and why. */
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

/** The text a suggestion was made on: a passage's quote or a field's value then. */
function originalText(suggestion: AgentSuggestion): string | null {
  const { anchor } = suggestion;
  if (anchor.kind === 'span') return anchor.quote.exact;
  return anchor.kind === 'field' ? anchor.expected : null;
}

/** Add to context on a suggestion that needs a fact: its question and the text it is about. */
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
    return <span className={textRole('itemTitle')}>{suggestion.needs_input}</span>;
  if (suggestion.replacement === null)
    return <span className={textRole('itemTitle')}>{suggestion.rationale}</span>;
  return (
    <Stack as="span" gap="tight">
      <span className={textRole('itemTitle', '[overflow-wrap:anywhere]')}>
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

/** A heuristic or a search policy says so beside the category; a recommendation needs no label. */
function StrengthBadge({ guidance }: Readonly<{ guidance: Guidance | null }>) {
  const badge = guidance ? suggestionStrengthCopy(guidance.strength).badge : null;
  return badge ? <Badge tone="neutral">{badge}</Badge> : null;
}

/** Where the suggestion's rule comes from, linked, worded as an option unless it is a policy. */
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
        variant="ghost"
        disabled={disabled}
        aria-describedby={textId}
        onClick={() => onChange(suggestion, 'dismiss')}
      >
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
    /** Whether the reader's role may act on the suggestion at all. */
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
    <Stack
      as="li"
      id={suggestionCardId(suggestion.id)}
      aria-current={selected || undefined}
      gap="item"
      className={panelClasses('suggestion-card')}
    >
      <Inline className="flex-wrap">
        <Badge tone={suggestion.readiness === 'needs_input' ? 'warning' : 'info'}>
          {suggestionCategoryLabel(suggestion.category)}
        </Badge>
        <StrengthBadge guidance={suggestion.guidance} />
        {suggestion.readiness === 'needs_input' ? <Badge tone="warning">Needs input</Badge> : null}
        {suggestion.choose_one ? <Badge tone="neutral">Choose one</Badge> : null}
      </Inline>
      {inPage ? (
        <Pressable className="hover:text-accent-ink" onClick={() => onShow(suggestion.id)}>
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
        <p className={textRole('caption')}>
          It overlaps another suggestion, so Apply all leaves it for you to choose.
        </p>
      ) : null}
      {canChange ? <Actions suggestion={suggestion} textId={textId} {...actions} /> : null}
    </Stack>
  );
}

function CoverageGaps({
  gaps,
  onAddToContext,
}: Readonly<{
  gaps: readonly GapMember[];
  /** Hands a gap to the composer; omitted for a role that may not ask the agent. */
  onAddToContext?: (reference: ContextReference) => void;
}>) {
  if (gaps.length === 0) return null;
  return (
    <Stack as="section" gap="compact" aria-labelledby="coverage-gaps">
      <h3 id="coverage-gaps" className={textRole('itemTitle')}>
        Coverage gaps
      </h3>
      <p className={textRole('caption')}>
        Topics AI answers cite other pages for, from this Action’s evidence.
      </p>
      <Stack as="ul" gap="compact">
        {gaps.map(({ id, evidence }) => (
          <Stack as="li" key={id} gap="item" className={panelClasses()}>
            <p className={textRole('itemTitle')}>{evidence.angle_label}</p>
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

/** Changes to the page document; any answer reads the page and its suggestions again. */
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

/** Apply all and Dismiss all, while any suggestion is open for review. */
function BulkActions({
  open,
  ready,
  disabled,
  changes,
}: Readonly<{
  open: number;
  /** Whether any open suggestion can be applied as it stands. */
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
      <Button variant="ghost" disabled={disabled} onClick={changes.dismissAll}>
        Dismiss all
      </Button>
    </Inline>
  );
}

const EMPTY: Readonly<Record<Filter, string>> = {
  open: 'Nothing to review. Ask the agent below for suggestions on the page.',
  applied: 'No suggestions applied yet.',
  dismissed: 'No suggestions dismissed.',
};

/**
 * The Suggestions tab: To review / Applied / Dismissed, cards grouped by the
 * passage they sit in, then Apply all and Dismiss all, then the Action's
 * coverage gaps. Every change names the revision on screen; a page that moved
 * on is read again and said so, and a refusal shows the server's reason.
 */
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
  /** The page document and the revision on screen, which every change names. */
  target: { chatId: string; outputId: string; baseRevisionId: string };
  /** The suggestions against the revision on screen. */
  page: AgentSuggestionsPage;
  /** That revision's body: the passages the suggestions sit in. */
  body: string;
  /** Why changes are paused (a running turn, unsaved edits), or null. */
  locked: string | null;
  gaps: readonly GapMember[];
  selectedId: string | null;
  onShow: (id: string) => void;
  onAddToContext: (reference: ContextReference) => void;
}>) {
  const [filter, setFilter] = useState<Filter>('open');
  const [shownSelection, setShownSelection] = useState(selectedId);
  const changes = useSuggestionChanges(workspaceId, target);
  // Changing the page, or asking the agent to, is a run; a role without it
  // reads the suggestions with no control to act on them.
  const canChange = useWorkspaceCapability('run');
  // A highlight pressed in the page opens its card, which is always To review.
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
      {changes.notice ? (
        <Callout tone={changes.notice.tone}>{changes.notice.message}</Callout>
      ) : null}
      {items.length === 0 ? <p className={textRole('body')}>{EMPTY[filter]}</p> : null}
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
          {pluralCount(counts.stale, 'suggestion')} no longer fit the page after later edits, so{' '}
          {counts.stale === 1 ? 'it is' : 'they are'} not shown.
        </p>
      ) : null}
      <CoverageGaps gaps={gaps} onAddToContext={canChange ? onAddToContext : undefined} />
    </Stack>
  );
}
