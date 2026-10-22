'use client';

import { Badge } from '@/components/ui/badge';
import { Inline, Stack } from '@/components/ui/layout';
import { OnPageEntities } from '@/components/ui/on-page-entities';
import { panelClasses } from '@/components/ui/panel';
import { TextLink } from '@/components/ui/text-link';
import { Limitations } from '@/components/ui/passage';
import { Label, textRole } from '@/components/ui/typography';
import type { OpportunityDetail } from '@/lib/api/types';
import { promptHistoryHref } from '@/lib/prompts/history';
import { BrandOnPage } from '@/components/visibility/brand-on-page';
import { brandVerdict, onPageCompetitors, readingSentence } from '@/lib/visibility/source-pages';
import { urlTypeLabel } from '@/lib/visibility/vocabulary';

type Handoff = OpportunityDetail['content_handoff'];

/**
 * The evidence behind one earned-page action, on the screen where the decision
 * is made: what to ask the publisher for, the competitors found on the page
 * with the line that proves each, where the brand stands, and the prompts
 * whose visibility is measured once the work is declared.
 *
 * Two sets of names appear here and they never merge. Competitors found ON
 * the page each carry their quoted line; `answer_competitors` were merely
 * named in an answer that cited it, are labelled as such, and never affected
 * this task's priority.
 */
export function EarnedPageHandoff({ detail }: Readonly<{ detail: OpportunityDetail }>) {
  const handoff = detail.content_handoff;
  const format = urlTypeLabel(handoff.page_format);
  return (
    <Stack as="section">
      <Label>Action handoff</Label>
      <Stack className={panelClasses()}>
        <p className={textRole('body')}>
          Get listed on this page. Competitors are on it and you are not.
        </p>
        <Inline className="flex-wrap">
          {handoff.canonical_domain ? (
            <Badge variant="neutral">{handoff.canonical_domain}</Badge>
          ) : null}
          {format ? <Badge variant="neutral">{format}</Badge> : null}
        </Inline>
        {handoff.ask ? (
          <Stack gap="tight">
            <p className={textRole('label')}>What to ask for</p>
            <p className={textRole('body')}>{handoff.ask}</p>
          </Stack>
        ) : null}
        <OnPageEntities
          heading="Found on this page"
          entities={onPageCompetitors(handoff.page_entities)}
        />
        <Brand handoff={handoff} />
        <Prompts prompts={handoff.affected_prompts} />
        <NamedInAnswers names={handoff.answer_competitors} />
        <Coverage handoff={handoff} />
        <Limitations items={handoff.limitations} />
      </Stack>
    </Stack>
  );
}

function Brand({ handoff }: Readonly<{ handoff: Handoff }>) {
  const brand = brandVerdict(handoff.page_entities);
  if (!brand) return null;
  return (
    <BrandOnPage
      heading="You on this page"
      brand={brand}
      extractedChars={handoff.extracted_chars ?? 0}
    />
  );
}

/** The tracked prompts whose answers cited the page: what declaring the work measures. */
function Prompts({ prompts }: Readonly<{ prompts?: Handoff['affected_prompts'] }>) {
  if (!prompts?.length) return null;
  return (
    <Stack gap="tight">
      <p className={textRole('label')}>Prompts that cite this page</p>
      <Stack as="ul" gap="tight">
        {prompts.map((prompt) => (
          <li key={prompt.prompt_id} className={textRole('body')}>
            <TextLink href={promptHistoryHref(prompt.prompt_id)} text="inherit">
              {prompt.text}
            </TextLink>
          </li>
        ))}
      </Stack>
      <p className="type-caption">
        Once you mark this done, visibility on these prompts is measured after the next runs. The
        history of each prompt marks when the work went live.
      </p>
    </Stack>
  );
}

/**
 * Competitors merely NAMED in an answer that cited this page.
 *
 * Kept visibly apart from the on-page findings and stated as what it is. This
 * set attaches every name in an answer to every page that answer cited, which
 * is exactly why it never scored anything.
 */
function NamedInAnswers({ names }: Readonly<{ names?: string[] }>) {
  if (!names?.length) return null;
  return (
    <Stack>
      <p className={textRole('label')}>Named in the answers, not on the page</p>
      <Inline className="flex-wrap">
        {names.map((name) => (
          <Badge key={name} variant="neutral">
            {name}
          </Badge>
        ))}
      </Inline>
      <p className="type-caption">
        These appeared somewhere in an answer that cited this page. They are not a finding about the
        page and did not affect this task&apos;s priority.
      </p>
    </Stack>
  );
}

function Coverage({ handoff }: Readonly<{ handoff: Handoff }>) {
  const sentence = readingSentence(handoff.read_at, handoff.extracted_chars);
  const frequency = handoff.observed_citation_frequency;
  if (!sentence && !frequency) return null;
  return (
    <Stack gap="tight">
      <p className={textRole('label')}>Coverage</p>
      {sentence ? <p className={textRole('caption')}>{sentence}</p> : null}
      {frequency ? (
        <p className={textRole('caption')}>
          Cited by {frequency.answers_citing_page} of {frequency.eligible_answers} analyzed answers.
        </p>
      ) : null}
    </Stack>
  );
}
