import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { ProjectLink } from '@/components/ui/project-link';
import { VerificationObservations } from '@/components/opportunities/verification-observations';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DisplayTime } from '@/components/ui/display-time';
import { ExternalHttpLink } from '@/components/ui/external-http-link';
import { Inline, Stack } from '@/components/ui/layout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import {
  checkKindLabel,
  checkKindNote,
  checkReasonLabel,
  checkStateLabel,
  checkSubject,
  IMPLEMENTATION_STATE_LABEL,
  measurementLegLabel,
} from '@/lib/agent/vocabulary';
import type { ActionDeclaration, MeasurementLeg } from '@/lib/api/actions';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { pluralCount, readableUrl } from '@/lib/format';
import { siteHealthMutations } from '@/lib/api/site-health-queries';
import { promptHistoryHref } from '@/lib/prompts/history';
import { useProjectContext, useWorkspaceCapability } from '@/lib/project/project-context';

/**
 * Where a user starts the reading a leg is waiting for; nothing runs by
 * itself. A crawl can start from here.
 */
const LEG_OWNER: Record<MeasurementLeg['leg'], { href: string; label: string } | null> = {
  next_visibility_run: { href: '/runs', label: 'Open Runs' },
  next_search_console_window: {
    href: '/performance',
    label: 'Open Performance',
  },
  // A crawl starts from here: Run crawl now.
  next_crawl: null,
};

/**
 * What the declaration measures. Findings a refresh resolved before go-live
 * are not credited to the change, which is distinct from findings no check
 * applies to.
 */
function Measurement({ declaration }: Readonly<{ declaration: ActionDeclaration }>) {
  if (declaration.resolved_before_snapshot_id)
    return (
      <p className={textRole('body')}>
        These findings were already resolved before this went live, so the outcome is not credited
        to this change and nothing is measured.
      </p>
    );
  if (declaration.checks.length === 0)
    return (
      <p className={textRole('body')}>
        No automatic check applies to these findings, so CiteLadder records the work but cannot
        verify it.
      </p>
    );
  return (
    <>
      <p className={textRole('body')} aria-live="polite">
        {IMPLEMENTATION_STATE_LABEL[declaration.state]}
      </p>
      <Stack as="ul" gap="compact" aria-label="Checks">
        {declaration.checks.map((check) => (
          <CheckRow key={check.index} check={check} />
        ))}
      </Stack>
    </>
  );
}

/**
 * A declared Action: when it went live, each check's latest reading, what the
 * next readings wait for, and what the readings can and cannot show.
 */
export function DeclarationStatus({
  declaration,
  shownRevision,
  workspaceId,
  focusOnMount = false,
}: Readonly<{
  declaration: ActionDeclaration;
  /** The revision on screen, when shown beside an output. */
  shownRevision?: { id: string; number: number };
  workspaceId: string;
  /** Move focus here: the dialog that declared it just closed with its trigger gone. */
  focusOnMount?: boolean;
}>) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) heading.current?.focus();
  }, [focusOnMount]);
  const hasVisibility = declaration.checks.some((check) => check.leg === 'next_visibility_run');
  // A crawl is worth starting while any page check still lacks a met reading.
  const crawlOpen = declaration.checks.some(
    (check) => check.leg === 'next_crawl' && check.state !== 'met',
  );
  return (
    <Stack gap="compact">
      <p className={textRole('body')}>
        Went live on <DisplayTime value={declaration.declared_implemented_at} dateOnly />
        {revisionNote(declaration.output_revision_id, shownRevision)}
      </p>
      <Deployment declaration={declaration} />
      <h3 ref={heading} tabIndex={-1} className={textRole('itemTitle', 'focus-ring w-fit')}>
        Measurement
      </h3>
      <Measurement declaration={declaration} />
      {declaration.legs.length > 0 ? (
        <Stack as="ul" gap="compact" aria-label="Next readings">
          {declaration.legs.map((leg) => (
            <LegRow
              key={leg.leg}
              leg={leg}
              workspaceId={workspaceId}
              offerCrawl={leg.leg === 'next_crawl' && crawlOpen}
            />
          ))}
        </Stack>
      ) : null}
      {declaration.checks.length > 0 ? (
        <p className={textRole('caption')}>
          New evidence is read until <DisplayTime value={declaration.measured_until} dateOnly />. A
          met check shows the change is live and measured; it does not prove this Action caused any
          movement, and other changes can overlap.
        </p>
      ) : null}
      <VerificationObservations implementation={declaration} showAuditLink={hasVisibility} />
    </Stack>
  );
}

const CHECK_TONE = {
  met: 'success',
  unmet: 'danger',
  unavailable: 'warning',
} as const;

function CheckRow({ check }: Readonly<{ check: ActionDeclaration['checks'][number] }>) {
  const tone = check.state === 'waiting' ? null : CHECK_TONE[check.state];
  const reason = checkReasonLabel(check.reason);
  const subject = checkSubject(check);
  const note = checkKindNote(check.kind);
  return (
    <Stack as="li" gap="tight">
      <Inline as="span" className="flex-wrap">
        <span className={textRole('itemTitle')}>{checkKindLabel(check.kind)}</span>
        {tone ? (
          <Badge variant="status" value={tone}>
            {checkStateLabel(check)}
          </Badge>
        ) : (
          <Badge>{checkStateLabel(check)}</Badge>
        )}
      </Inline>
      {subject ? <CheckSubject subject={subject} promptId={check.prompt_id} /> : null}
      {check.pages ? <FamilyPages pages={check.pages} /> : null}
      {note ? <span className={textRole('caption')}>{note}</span> : null}
      {reason || check.observed_at ? (
        <span className={textRole('caption')}>
          {reason}
          {reason && check.observed_at ? ' · ' : null}
          {check.observed_at ? (
            <>
              Read <DisplayTime value={check.observed_at} dateOnly />
            </>
          ) : null}
        </span>
      ) : null}
    </Stack>
  );
}

/** How many of the shown failing pages an issue-family reading lists before "and N more". */
const FAILING_PAGES_SHOWN = 20;

/**
 * An issue-family reading: how many cohort pages pass, fail, no longer apply
 * or went unread, how many affected pages lie beyond the cohort, and which
 * still fail.
 */
function FamilyPages({
  pages,
}: Readonly<{ pages: NonNullable<ActionDeclaration['checks'][number]['pages']> }>) {
  const shown = pages.failing.slice(0, FAILING_PAGES_SHOWN);
  const more = pages.failing.length - shown.length;
  const count = (n: number, one: string, many: string) =>
    `${pluralCount(n, 'page')} ${n === 1 ? one : many}`;
  const counts = [
    count(pages.passing, 'passes', 'pass'),
    count(pages.failing.length, 'still fails', 'still fail'),
    pages.not_applicable
      ? count(pages.not_applicable, 'no longer applies', 'no longer apply')
      : null,
    pages.unread ? count(pages.unread, 'not read', 'not read') : null,
    pages.uncovered ? count(pages.uncovered, 'not checked', 'not checked') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Stack gap="tight">
      <span className={textRole('caption')}>{counts}</span>
      {shown.length ? (
        <Stack as="ul" gap="tight" aria-label="Pages still failing">
          {shown.map((page) => (
            <li key={page.site_url_id} className={textRole('caption', 'break-all')}>
              {readableUrl(page.url)}
            </li>
          ))}
          {more > 0 ? <li className={textRole('caption')}>and {more} more</li> : null}
        </Stack>
      ) : null}
    </Stack>
  );
}

/** What a check names; a prompt opens its history. */
function CheckSubject({
  subject,
  promptId,
}: Readonly<{ subject: string; promptId?: string | null }>) {
  if (promptId)
    return (
      <TextLink href={promptHistoryHref(promptId)} text="caption">
        {subject}
      </TextLink>
    );
  return <span className={textRole('caption', 'break-all')}>{subject}</span>;
}

/**
 * The recorded deployment step: who recorded the go-live and what shipped it.
 * A reference that is a web address opens in a new tab; any other stays text.
 */
function Deployment({ declaration }: Readonly<{ declaration: ActionDeclaration }>) {
  const { deployed_by: by, deployment_reference: reference } = declaration;
  return (
    <p className={textRole('caption', 'break-words')}>
      {by ? `Deployment recorded by ${by}` : 'Deployment recorded by a former workspace member'}
      {reference ? (
        <>
          {' · '}
          <ExternalHttpLink href={reference} className="underline underline-offset-2">
            {reference}
          </ExternalHttpLink>
        </>
      ) : null}
    </p>
  );
}

function revisionNote(
  declaredId: string | null,
  shown: { id: string; number: number } | undefined,
): string {
  if (!declaredId) return ' · done outside CiteLadder';
  if (!shown) return '';
  // Later edits are not what was shipped; say so rather than imply they were.
  return declaredId === shown.id
    ? ` · revision ${shown.number}`
    : ' · an earlier revision; this one was not declared';
}

function LegRow({
  leg,
  workspaceId,
  offerCrawl,
}: Readonly<{
  leg: MeasurementLeg;
  workspaceId: string;
  offerCrawl: boolean;
}>) {
  const owner = LEG_OWNER[leg.leg];
  const waiting = leg.state !== 'observed';
  return (
    <Stack as="li" gap="tight">
      <span className={textRole('itemTitle')}>{measurementLegLabel(leg.leg)}</span>
      <span className={textRole('caption')}>
        <LegWait leg={leg} />
        {waiting && owner ? (
          <>
            {' '}
            <ProjectLink href={owner.href} className="underline underline-offset-2">
              {owner.label}
            </ProjectLink>
          </>
        ) : null}
      </span>
      {offerCrawl ? <RunCrawl workspaceId={workspaceId} /> : null}
    </Stack>
  );
}

/** Start the crawl a page check waits for, without leaving the Action. */
function RunCrawl({ workspaceId }: Readonly<{ workspaceId: string }>) {
  const { activeProjectId } = useProjectContext();
  const mayWrite = useWorkspaceCapability('write');
  const start = useMutation(siteHealthMutations.createCrawl(workspaceId));
  if (!mayWrite || !activeProjectId) return null;
  if (start.isSuccess)
    return (
      <output className={textRole('caption')}>
        Crawl started. The checks update when it finishes.{' '}
        <ProjectLink href="/site" className="underline underline-offset-2">
          Open Site Health
        </ProjectLink>
      </output>
    );
  return (
    <Stack gap="compact">
      <div>
        <Button
          variant="secondary"
          pending={start.isPending}
          pendingLabel="Starting…"
          onClick={() => start.mutate({ project_id: activeProjectId })}
        >
          Run crawl now
        </Button>
      </div>
      {start.isError ? (
        <MutationNotice
          notice={mutationNoticeForError(start.error, {
            action: 'start a crawl',
          })}
          onRetry={() => start.mutate({ project_id: activeProjectId })}
        />
      ) : null}
    </Stack>
  );
}

function LegWait({ leg }: Readonly<{ leg: MeasurementLeg }>) {
  if (leg.state === 'observed') {
    return leg.last_evidence_at ? (
      <>
        Read · <DisplayTime value={leg.last_evidence_at} dateOnly />
      </>
    ) : (
      <>Read</>
    );
  }
  if (leg.state === 'sync_needed')
    return <>The window has closed. Sync Search Console to measure it.</>;
  if (leg.state === 'waiting') {
    return leg.due_at ? (
      <>
        Waiting · expected <DisplayTime value={leg.due_at} dateOnly />.
      </>
    ) : (
      <>Waiting for the next reading; its date is not known.</>
    );
  }
  return <>{NOT_SCHEDULED[leg.leg]}</>;
}

const NOT_SCHEDULED: Record<MeasurementLeg['leg'], string> = {
  next_visibility_run: 'No visibility run is scheduled. Run or schedule one to measure.',
  next_search_console_window: 'Waiting for the next complete window.',
  next_crawl: 'Crawls run when you start one.',
};
