'use client';

import { CheckCircle2, Quote, Search, XCircle } from 'lucide-react';

import { MeasurementContext } from '@/components/runs/measurement-context';
import { SurfaceEvidence } from '@/components/runs/surface-evidence';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { StatGrid, StatItem } from '@/components/ui/stat-grid';
import { TextLink } from '@/components/ui/text-link';
import { Label, textRole } from '@/components/ui/typography';
import { engineLabel, productModelLabel, productTransportLabel } from '@/lib/providers/catalog';
import type { ExecutionEvidence } from '@/lib/api/types';
import { classificationBadgeValue, classificationLabel } from '@/lib/runs/status';
import { cn } from '@/lib/utils';

import { ContentMarkdown } from '@/lib/markdown/markdown';
import type { Highlight } from '@/lib/markdown/highlight';
import { claimHighlights, EvidenceClaims } from '@/components/runs/evidence-claims';
import { EvidencePerception, perceptionHighlights } from '@/components/runs/evidence-perception';
import { EvidenceAds } from '@/components/runs/evidence-ads';
import { panelClasses } from '@/components/ui/panel';
import { ledgerClasses } from '@/components/ui/workspace';

function safeCitationUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function Outcome({
  label,
  detail,
  passed,
}: Readonly<{ label: string; detail: string; passed: boolean }>) {
  const Icon = passed ? CheckCircle2 : XCircle;
  return (
    <div className={panelClasses({ tone: 'well' }, 'flex min-w-0 items-start gap-2')}>
      <Icon
        className={cn('mt-0.5 size-4 shrink-0', passed ? 'text-success' : 'text-muted')}
        aria-hidden
      />
      <div className="min-w-0">
        <p className={textRole('itemTitle')}>{label}</p>
        <p className="type-caption">{detail}</p>
      </div>
    </div>
  );
}

function EvidencePromptHeader({
  evidence,
  promptText,
  promptIndex,
}: Readonly<{
  evidence: ExecutionEvidence;
  promptText?: string | null;
  promptIndex?: number;
}>) {
  const displayPrompt =
    promptText ||
    (promptIndex !== undefined
      ? `Prompt #${promptIndex + 1}`
      : `Prompt #${evidence.prompt_index + 1}`);
  const promptBadgeNumber = promptIndex !== undefined ? promptIndex + 1 : evidence.prompt_index + 1;
  // Null for an observed search surface, whose engine name is already the whole
  // product fact; the vendor behind it stays on the Settings credential card.
  const transport = productTransportLabel(evidence.transport_provider);

  return (
    <section className="border-border-subtle grid min-w-0 gap-2 border-b pb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant="neutral">Prompt #{promptBadgeNumber}</Badge>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">
            {engineLabel(evidence.logical_engine)}
            {transport ? ` · ${transport}` : ''}
          </Badge>
          <MeasurementContext
            retrieval={evidence.retrieval_enabled}
            model={productModelLabel(evidence.logical_engine, evidence.transport_model)}
          />
        </div>
      </div>
      <p className={textRole('body')}>{displayPrompt}</p>
    </section>
  );
}

function EvidenceMetrics({ evidence }: Readonly<{ evidence: ExecutionEvidence }>) {
  return (
    <StatGrid surface="well" columns={4}>
      <StatItem
        label="Brand"
        value={evidence.brand_mentioned ? 'Mentioned' : 'Not mentioned'}
        tone={outcomeTone(evidence.brand_mentioned)}
      />
      <StatItem
        label="Owned sources"
        value={evidence.owned_citation_count}
        tone={outcomeTone(evidence.owned_citation_count > 0)}
      />
      <StatItem label="Citations" value={evidence.citation_count} />
      <StatItem
        label="Searches"
        value={evidence.search_used ? evidence.search_query_count : 'Not used'}
        tone={outcomeTone(evidence.search_used)}
      />
    </StatGrid>
  );
}

const listItemBlock = /^ {0,3}(?:[-*+] |\d+[.)] )/;
const structuralBlock = /^ {0,3}(?:#{1,6} |[-*+] |\d+[.)] |>|```|~~~|\|)/;
const indentedBlock = /^(?: {4}|\t)/;
const sentenceEnd = /[.!?:;\])}"'…](?:[*_~]+)?$/;
const punctuationOnly = /^[,.;:!?)\]}]+(?:[*_~]+)?$/;
const commaFragment = /^,\s/;
const sentenceFragment = /^(?:\p{Ll}|\+\d)/u;

function joinsWithoutSpace(previous: string, block: string, content: string): boolean {
  return (
    listItemBlock.test(previous) &&
    !indentedBlock.test(block) &&
    (punctuationOnly.test(content) || commaFragment.test(content))
  );
}

function joinsWithSpace(previous: string, block: string, content: string): boolean {
  return (
    listItemBlock.test(previous) &&
    !indentedBlock.test(block) &&
    !structuralBlock.test(block) &&
    !sentenceEnd.test(previous) &&
    !sentenceEnd.test(content) &&
    sentenceFragment.test(content)
  );
}

/**
 * Repair paragraph breaks introduced around inline citation annotations.
 *
 * Some answer transports persist a list item as several blank-line-separated
 * fragments (including punctuation in a block of its own). Markdown correctly
 * treats those as separate paragraphs, but the reader sees a sentence pulled
 * apart vertically. This changes only the rendered copy: the persisted answer
 * remains the immutable evidence and proper Markdown blocks remain untouched.
 */
export function normalizeEvidenceMarkdown(markdown: string): string {
  const blocks = markdown
    .replaceAll('\r\n', '\n')
    .split(/\n{2,}/)
    .map((block) => block.trimEnd())
    .filter((block) => block.trim());
  const normalized: string[] = [];

  for (const block of blocks) {
    const previous = normalized.at(-1);
    if (!previous) {
      normalized.push(block);
      continue;
    }
    const blockContent = block.trimStart();
    if (joinsWithoutSpace(previous, block, blockContent)) {
      normalized[normalized.length - 1] = `${previous}${blockContent}`;
      continue;
    }
    if (joinsWithSpace(previous, block, blockContent)) {
      normalized[normalized.length - 1] = `${previous} ${blockContent}`;
      continue;
    }
    normalized.push(block);
  }

  return normalized.join('\n\n');
}

function EvidenceAnswer({
  answerText,
  isSearchSurface,
  outcome,
  highlights,
}: Readonly<{
  answerText?: string | null;
  isSearchSurface?: boolean;
  outcome?: string;
  highlights: readonly Highlight[];
}>) {
  const trimmed = answerText?.trim();
  // An observed surface with no text is two completely different things, and
  // only the persisted OUTCOME separates them. Inferring from "succeeded and
  // empty" was wrong: an overview that was present but carried no extractable
  // text produces exactly that, and would have been reported as Google
  // showing nothing — our own gap presented as the brand's absence.
  const measuredAbsence = Boolean(isSearchSurface) && outcome === 'no_ai_overview';
  return (
    <section className="grid gap-2">
      <Label>{isSearchSurface ? 'AI Overview' : 'Engine response'}</Label>
      <div className={panelClasses({ tone: 'well' }, 'min-w-0 overflow-hidden')}>
        <EvidenceAnswerBody
          text={trimmed}
          measuredAbsence={measuredAbsence}
          highlights={highlights}
        />
      </div>
    </section>
  );
}

/**
 * The three states an answer panel can be in, named rather than nested.
 *
 * They are genuinely three, not two: text, a measured absence, and a missing
 * capture. The middle one is a finding and the last one is a gap in ours, so
 * they must never share a sentence.
 */
function EvidenceAnswerBody({
  text,
  measuredAbsence,
  highlights,
}: Readonly<{ text?: string; measuredAbsence: boolean; highlights: readonly Highlight[] }>) {
  if (text) {
    return (
      <ContentMarkdown
        markdown={normalizeEvidenceMarkdown(text)}
        density="compact"
        highlights={highlights}
      />
    );
  }
  if (measuredAbsence) {
    return <span className="type-body">No AI Overview was shown for this search.</span>;
  }
  return <span className="type-body">No answer text was captured for this execution.</span>;
}

/** Present, absent and not-applicable are three tones, not a boolean. */
function outcomeTone(positive: boolean | undefined): 'success' | 'muted' | 'default' {
  if (positive === true) return 'success';
  return positive === false ? 'muted' : 'default';
}

function brandOutcomeDetail(evidence: ExecutionEvidence): string {
  if (!evidence.brand_mentioned) return 'No tracked brand alias appeared in the answer';
  if (evidence.brand_first_offset === null) return 'Brand detected; match position unavailable';
  return `First match at character ${evidence.brand_first_offset}`;
}

function EvidenceOutcomes({ evidence }: Readonly<{ evidence: ExecutionEvidence }>) {
  const brandDetail = brandOutcomeDetail(evidence);
  const ownedNoun = evidence.owned_citation_count === 1 ? 'source' : 'sources';
  const ownedDetail = `${evidence.owned_citation_count} owned ${ownedNoun} found`;
  const searchNoun = evidence.search_query_count === 1 ? 'search' : 'searches';
  const searchDetail = evidence.search_used
    ? `${evidence.search_query_count} ${searchNoun} recorded`
    : 'The provider did not report web search';
  const competitorDetail =
    evidence.competitors_mentioned.length > 0
      ? evidence.competitors_mentioned.join(', ')
      : 'No configured competitors appeared';

  return (
    <section className="grid gap-3">
      <div className="grid gap-0.5">
        <Label>Why it scored this way</Label>
        <p className="type-caption">
          Deterministic checks against the persisted answer and source evidence.
        </p>
      </div>
      <div className="desktop:grid-cols-2 grid gap-3">
        <Outcome label="Brand detected" detail={brandDetail} passed={evidence.brand_mentioned} />
        <Outcome
          label="Owned source cited"
          detail={ownedDetail}
          passed={evidence.owned_domain_cited}
        />
        <Outcome label="Grounded with search" detail={searchDetail} passed={evidence.search_used} />
        <Outcome
          label="Competitor pressure"
          detail={competitorDetail}
          passed={evidence.competitors_mentioned.length === 0}
        />
      </div>
    </section>
  );
}

function CitationItem({
  citation,
}: Readonly<{ citation: ExecutionEvidence['citations'][number] }>) {
  const href = safeCitationUrl(citation.url);
  const ordinal = citation.ordinal > 0 ? citation.ordinal : citation.ordinal + 1;
  const title = citation.title || citation.domain || citation.url;

  return (
    <li className="flex gap-3 p-4">
      <span className={textRole('label', 'tabular-nums mt-0.5 w-5 shrink-0')}>{ordinal}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-0.5">
            {href ? (
              <TextLink variant="external" text="itemTitle" href={href} className="max-w-full">
                <span className="truncate">{title}</span>
              </TextLink>
            ) : (
              <p className={textRole('itemTitle', 'truncate')}>{title || 'Untitled source'}</p>
            )}
            <p className="type-caption truncate">{citation.domain}</p>
          </div>
          <Badge
            className="shrink-0"
            variant="classification"
            value={classificationBadgeValue(citation.classification)}
          >
            {classificationLabel(citation.classification)}
          </Badge>
        </div>
      </div>
    </li>
  );
}

function EvidenceCitationsList({
  citations,
}: Readonly<{ citations: ExecutionEvidence['citations'] }>) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <Label>Citations</Label>
        <span className="type-caption">
          {citations.length} {citations.length === 1 ? 'source' : 'sources'}
        </span>
      </div>
      {citations.length === 0 ? (
        <EmptyState
          variant="compact"
          headingLevel={3}
          icon={Quote}
          heading="No citations were captured from this response."
        />
      ) : (
        <ol className={ledgerClasses('boxed')}>
          {citations.map((citation) => (
            <CitationItem key={`${citation.ordinal}-${citation.url}`} citation={citation} />
          ))}
        </ol>
      )}
    </section>
  );
}

function EvidenceFooter({ evidence }: Readonly<{ evidence: ExecutionEvidence }>) {
  return (
    <footer className="type-caption border-border-subtle flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3">
      <span className="inline-flex items-center gap-1">
        <Search className="size-3" aria-hidden />
        {evidence.prompt_class.replaceAll('_', ' ')} prompt
      </span>
      <span>Analyzer {evidence.analyzer_version}</span>
      <span>Rules {evidence.scoring_rule_version}</span>
    </footer>
  );
}

/** Clear, persisted explanation of one execution's deterministic evidence. */
export function EvidenceCard({
  evidence,
  answerText,
  promptText,
  promptIndex,
  isSearchSurface,
  outcome,
}: Readonly<{
  evidence: ExecutionEvidence;
  answerText?: string | null;
  promptText?: string | null;
  promptIndex?: number;
  isSearchSurface?: boolean;
  outcome?: string;
}>) {
  return (
    <div className="grid min-w-0 gap-[var(--workspace-gap)]">
      <EvidencePromptHeader evidence={evidence} promptText={promptText} promptIndex={promptIndex} />
      <EvidenceMetrics evidence={evidence} />
      <EvidenceAnswer
        answerText={answerText}
        isSearchSurface={isSearchSurface}
        outcome={outcome}
        highlights={[
          ...perceptionHighlights(evidence.perception),
          ...claimHighlights(evidence.claims),
        ]}
      />
      <EvidencePerception perception={evidence.perception} />
      <EvidenceClaims claims={evidence.claims} />
      <EvidenceAds ads={evidence.ads} />
      {/* Only an observed surface has one, and its absence is not a state to
          render: an LLM execution has no overview to report on. */}
      {evidence.search_surface ? <SurfaceEvidence evidence={evidence.search_surface} /> : null}
      <EvidenceOutcomes evidence={evidence} />
      <EvidenceCitationsList citations={evidence.citations} />
      <EvidenceFooter evidence={evidence} />
    </div>
  );
}
