import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DisplayTime } from '@/components/ui/display-time';
import { FactList } from '@/components/ui/facts';
import { Inline, Stack } from '@/components/ui/layout';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import type { ActionDetail } from '@/lib/api/actions';
import { formatCount, pluralCount, readableUrl } from '@/lib/format';
import { promptHistoryHref } from '@/lib/prompts/history';
import { classificationBadgeValue, classificationLabel } from '@/lib/runs/status';
import { citationClassificationSchema } from '@citeladder/contracts/audits';
import type { ContentGapEvidence } from '@citeladder/contracts/opportunity-evidence';

/** A finding with the content-gap evidence the Action read returned for it. */
export type GapMember = Readonly<{ id: string; evidence: ContentGapEvidence }>;

/** A prompt the library no longer held when the refresh recorded the angle. */
const DELETED_PROMPT = 'A prompt no longer in your library';

/** The Action's content-gap findings with their evidence, in member order. */
export function contentGapMembers(action: ActionDetail): GapMember[] {
  return action.members.flatMap((member) =>
    member.content_gap_evidence ? [{ id: member.id, evidence: member.content_gap_evidence }] : [],
  );
}

/**
 * Why the content-gap findings of an Action matter, from their persisted
 * evidence only, as the Action read returned it: each angle, the competitor
 * and publisher pages cited for it with their domain and classification, the
 * prompts as their text read at the refresh, the counts and the window.
 * Counts, never a score (CO14).
 */
export function ContentGapWhy({ members }: Readonly<{ members: readonly GapMember[] }>) {
  return (
    <Card aria-labelledby="action-why">
      <CardHeader>
        <CardTitle id="action-why">Why this matters</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className={ledgerClasses()}>
          {members.map((member) => (
            <li key={member.id} className={ledgerItemClasses()}>
              <GapAngle evidence={member.evidence} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function GapAngle({ evidence }: Readonly<{ evidence: ContentGapEvidence }>) {
  return (
    <Stack>
      <p className={textRole('itemTitle')}>{evidence.angle_label}</p>
      <GapEvidence evidence={evidence} />
    </Stack>
  );
}

/**
 * One angle's evidence under its label: the counts and window, the cited
 * pages and the prompts. The page workspace shows it under a coverage gap.
 */
export function GapEvidence({ evidence }: Readonly<{ evidence: ContentGapEvidence }>) {
  const { prompts } = evidence;
  const continues = 'continues_action_id' in evidence ? evidence.continues_action_id : undefined;
  return (
    <>
      <FactList
        layout="inline"
        label="Counts"
        facts={[
          { label: 'Citations', value: formatCount(evidence.citation_count) },
          { label: 'Sites', value: formatCount(evidence.domain_count) },
          { label: 'Competitors', value: formatCount(evidence.competitor_count) },
          { label: 'Prompts', value: formatCount(prompts.length) },
          {
            label: 'Window',
            value: (
              <span>
                <DisplayTime value={evidence.window.start} dateOnly /> to{' '}
                <DisplayTime value={evidence.window.end} dateOnly />
              </span>
            ),
          },
        ]}
      />
      <Stack as="section" gap="tight" aria-label="Cited pages">
        <span className={textRole('label')}>Cited pages</span>
        <ul className={ledgerClasses()}>
          {evidence.members.map((page) => (
            <CitedPage key={page.url} page={page} />
          ))}
        </ul>
        {evidence.member_count > evidence.members.length ? (
          <span className={textRole('caption')}>
            The {formatCount(evidence.members.length)} most cited of{' '}
            {pluralCount(evidence.member_count, 'page')}.
          </span>
        ) : null}
      </Stack>
      {prompts.length > 0 ? (
        <Stack as="section" gap="tight" aria-label="Prompts">
          <span className={textRole('label')}>Prompts</span>
          <Stack as="ul" gap="tight">
            {prompts.map((prompt) => (
              <li key={prompt.id}>
                {prompt.text === null ? (
                  // Recorded at the refresh without text: the library no longer had it.
                  <span className={textRole('body', 'text-ink-secondary')}>{DELETED_PROMPT}</span>
                ) : (
                  <TextLink href={promptHistoryHref(prompt.id)} text="body">
                    {prompt.text}
                  </TextLink>
                )}
              </li>
            ))}
          </Stack>
        </Stack>
      ) : null}
      {continues ? (
        <TextLink href={`/agent/actions/${continues}`} text="body" className="justify-self-start">
          Continues the planned page for this angle
        </TextLink>
      ) : null}
    </>
  );
}

/** One cited page: its title, then its site, classification and citations. */
function CitedPage({ page }: Readonly<{ page: ContentGapEvidence['members'][number] }>) {
  const classification = citationClassificationSchema.safeParse(page.classification);
  const site = page.matched_competitor
    ? `${page.matched_competitor} (${page.domain})`
    : page.domain;
  return (
    <Stack as="li" gap="tight" className={ledgerItemClasses()}>
      <TextLink variant="external" href={page.url} text="body" className="justify-self-start">
        {page.title || readableUrl(page.url)}
      </TextLink>
      <Inline gap="compact" className="flex-wrap">
        {classification.success ? (
          <Badge variant="classification" value={classificationBadgeValue(classification.data)}>
            {classificationLabel(classification.data)}
          </Badge>
        ) : null}
        <span className={textRole('caption')}>
          {site} · {pluralCount(page.citation_count, 'citation')}
        </span>
      </Inline>
    </Stack>
  );
}
