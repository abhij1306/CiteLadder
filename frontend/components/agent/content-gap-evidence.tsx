import { BrandMark } from '@/components/ui/brand-mark';
import { ClampText } from '@/components/ui/clamp-text';
import { StatusMark } from '@/components/ui/status-mark';
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

export type GapMember = Readonly<{ id: string; evidence: ContentGapEvidence }>;

const DELETED_PROMPT = 'A prompt no longer in your library';

export function contentGapMembers(action: ActionDetail): GapMember[] {
  return action.members.flatMap((member) =>
    member.content_gap_evidence ? [{ id: member.id, evidence: member.content_gap_evidence }] : [],
  );
}

export function ContentGapWhy({ members }: Readonly<{ members: readonly GapMember[] }>) {
  return (
    <ul className={ledgerClasses()}>
      {members.map((member) => (
        <li key={member.id} className={ledgerItemClasses()}>
          <GapAngle evidence={member.evidence} />
        </li>
      ))}
    </ul>
  );
}

function GapAngle({ evidence }: Readonly<{ evidence: ContentGapEvidence }>) {
  return (
    <Stack>
      <p className={textRole('body')}>{evidence.angle_label}</p>
      <GapEvidence evidence={evidence} />
    </Stack>
  );
}

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
        <span className={textRole('body', 'text-ink-2')}>Cited pages</span>
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
          <span className={textRole('body', 'text-ink-2')}>Prompts</span>
          <Stack as="ul" gap="tight">
            {prompts.map((prompt) => (
              <li key={prompt.id} className="min-w-0">
                {prompt.text === null ? (
                  <span className={textRole('body', 'text-ink-2')}>{DELETED_PROMPT}</span>
                ) : (
                  <ClampText tooltip={prompt.text}>
                    <TextLink href={promptHistoryHref(prompt.id)} text="body">
                      {prompt.text}
                    </TextLink>
                  </ClampText>
                )}
              </li>
            ))}
          </Stack>
        </Stack>
      ) : null}
      {continues ? (
        <TextLink href={`/actions/${continues}`} text="body" className="justify-self-start">
          Continues the planned page for this angle
        </TextLink>
      ) : null}
    </>
  );
}

function CitedPage({ page }: Readonly<{ page: ContentGapEvidence['members'][number] }>) {
  const classification = citationClassificationSchema.safeParse(page.classification);
  const site = page.matched_competitor
    ? `${page.matched_competitor} (${page.domain})`
    : page.domain;
  return (
    <Stack as="li" gap="tight" className={ledgerItemClasses()}>
      <ClampText tooltip={readableUrl(page.url)}>
        <TextLink variant="external" href={page.url} text="body">
          {page.title || readableUrl(page.url)}
        </TextLink>
      </ClampText>
      <Inline gap="compact" className="flex-wrap">
        {classification.success ? (
          <StatusMark
            variant="classification"
            value={classificationBadgeValue(classification.data)}
          >
            {classificationLabel(classification.data)}
          </StatusMark>
        ) : null}
        <BrandMark
          name={page.matched_competitor || page.domain}
          websiteUrl={page.domain}
          placement="inline"
        />
        <span className={textRole('caption')}>
          {site} · {pluralCount(page.citation_count, 'citation')}
        </span>
      </Inline>
    </Stack>
  );
}
