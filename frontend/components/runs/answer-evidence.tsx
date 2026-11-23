import { AnswerTranscript } from '@/components/runs/answer-transcript';
import { BrandsRail, FanoutRail, LinksRail, SourcesRail } from '@/components/runs/answer-rail';
import { EvidenceAds } from '@/components/runs/evidence-ads';
import { claimHighlights, EvidenceClaims } from '@/components/runs/evidence-claims';
import {
  AttributesRail,
  EvidencePerception,
  perceptionHighlights,
} from '@/components/runs/evidence-perception';
import { SurfaceEvidence } from '@/components/runs/surface-evidence';
import { AnswerLayout } from '@/components/ui/answer-chat';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { wellClasses } from '@/components/ui/slip';
import { textRole } from '@/components/ui/typography';
import { SubsectionHeader } from '@/components/ui/workspace';
import type { ExecutionEvidence } from '@citeladder/contracts';
import { CheckCircle2, XCircle } from '@/lib/icons';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { answerBrands, answerLinks, answerSources } from '@/lib/runs/answer-transcript';

function Outcome({
  label,
  detail,
  passed,
}: Readonly<{ label: string; detail: string; passed: boolean }>) {
  return (
    <Inline className={wellClasses('min-w-0 items-start')}>
      <Icon
        icon={passed ? CheckCircle2 : XCircle}
        className={passed ? 'text-positive' : 'text-ink-2'}
      />
      <div className="min-w-0">
        <p className={textRole('body')}>{label}</p>
        <p className="type-caption truncate" title={detail}>
          {detail}
        </p>
      </div>
    </Inline>
  );
}

function searchDetail(evidence: ExecutionEvidence): string {
  switch (evidence.search) {
    case 'used': {
      const noun = evidence.search_query_count === 1 ? 'search' : 'searches';
      return `${evidence.search_query_count} ${noun} recorded`;
    }
    case 'not_used':
      return 'The engine ran no web search';
    case 'not_reported':
      return 'Not reported: this engine does not say whether it searched the web';
    default: {
      const unreachable: never = evidence.search;
      return unreachable;
    }
  }
}

function brandOutcomeDetail(evidence: ExecutionEvidence): string {
  if (!evidence.brand_mentioned) return 'No tracked brand alias appeared in the answer';
  if (evidence.brand_first_offset === null) return 'Brand detected; match position unavailable';
  return `First match at character ${evidence.brand_first_offset}`;
}

function EvidenceOutcomes({ evidence }: Readonly<{ evidence: ExecutionEvidence }>) {
  const ownedNoun = evidence.owned_citation_count === 1 ? 'source' : 'sources';
  const competitorDetail =
    evidence.competitors_mentioned.length > 0
      ? evidence.competitors_mentioned.join(', ')
      : 'No configured competitors appeared';

  return (
    <Stack as="section">
      <SubsectionHeader title="Why it scored this way" />
      <Stack className="phone:grid-cols-1 desktop:grid-cols-4 grid-cols-2">
        <Outcome
          label="Brand detected"
          detail={brandOutcomeDetail(evidence)}
          passed={evidence.brand_mentioned}
        />
        <Outcome
          label="Owned source cited"
          detail={`${evidence.owned_citation_count} owned ${ownedNoun} found`}
          passed={evidence.owned_domain_cited}
        />
        <Outcome
          label="Grounded with search"
          detail={searchDetail(evidence)}
          passed={evidence.search === 'used'}
        />
        <Outcome
          label="Competitor pressure"
          detail={competitorDetail}
          passed={evidence.competitors_mentioned.length === 0}
        />
      </Stack>
    </Stack>
  );
}

const SURFACE_ABSENCE: Partial<Record<string, string>> = {
  google_ai_overview: 'No AI Overview was shown for this search.',
  google_ai_mode: 'No AI Mode answer was shown for this search.',
};

function transcriptBody(evidence: ExecutionEvidence) {
  const text = evidence.answer_text.trim();
  if (text) return { kind: 'markdown', text } as const;
  const absence = SURFACE_ABSENCE[evidence.logical_engine];
  if (absence && evidence.search_surface_outcome === 'no_ai_overview')
    return { kind: 'note', text: absence } as const;
  return { kind: 'note', text: 'No answer text was captured for this execution.' } as const;
}

export function AnswerEvidence({
  evidence,
  promptText,
  promptId,
  attributes = false,
}: Readonly<{
  evidence: ExecutionEvidence;
  promptText: string | null;
  promptId?: string;
  attributes?: boolean;
}>) {
  const { project } = useProjectScope();
  const brands = answerBrands(evidence, project);
  const sources = answerSources(evidence.citations);
  return (
    <AnswerLayout
      railLabel="Brands, sources, links and searches"
      rail={
        <>
          <BrandsRail brands={brands} />
          {attributes ? <AttributesRail perception={evidence.perception} /> : null}
          <SourcesRail sources={sources} />
          <LinksRail
            links={answerLinks(evidence.answer_text, project)}
            formats={evidence.answer_formats}
          />
          <FanoutRail evidence={evidence} promptId={promptId} />
        </>
      }
      main={
        <>
          <AnswerTranscript
            promptText={promptText}
            engine={evidence.logical_engine}
            body={transcriptBody(evidence)}
            brands={brands}
            sources={sources}
            highlights={[
              ...perceptionHighlights(evidence.perception),
              ...claimHighlights(evidence.claims),
            ]}
          />
          <EvidencePerception perception={evidence.perception} />
          <EvidenceClaims claims={evidence.claims} />
          <EvidenceAds ads={evidence.ads} />
          {evidence.search_surface ? (
            <SurfaceEvidence evidence={evidence.search_surface} engine={evidence.logical_engine} />
          ) : null}
          <EvidenceOutcomes evidence={evidence} />
        </>
      }
    />
  );
}
