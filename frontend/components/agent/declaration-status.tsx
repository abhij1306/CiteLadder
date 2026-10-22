'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { ProjectLink } from '@/components/layout/scoped-link';
import { VerificationObservations } from '@/components/opportunities/verification-observations';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DisplayTime } from '@/components/ui/display-time';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import {
  CHECK_STATE_LABEL,
  checkKindLabel,
  checkReasonLabel,
  IMPLEMENTATION_STATE_LABEL,
  measurementLegLabel,
} from '@/lib/agent/vocabulary';
import type { ActionDeclaration, MeasurementLeg } from '@/lib/api/actions';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { promptHistoryHref } from '@/lib/prompts/history';
import { queryKeys } from '@/lib/api/query-keys';
import { siteHealthMutations } from '@/lib/api/site-health';
import { useProjectContext, useWorkspaceCapability } from '@/lib/project/project-context';

/**
 * Where a user starts the reading a leg is waiting for; nothing runs by
 * itself. A crawl can start from here.
 */
const LEG_OWNER: Record<MeasurementLeg['leg'], { href: string; label: string } | null> = {
  next_visibility_run: { href: '/runs', label: 'Open Runs' },
  next_search_console_window: { href: '/performance', label: 'Open Performance' },
  // A crawl starts from here: Run crawl now.
  next_crawl: null,
};

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
  const hasVisibility = declaration.checks.some((check) => check.kind === 'visibility_metric');
  // A crawl is worth starting while any page check still lacks a met reading.
  const crawlOpen = declaration.checks.some(
    (check) => check.leg === 'next_crawl' && check.state !== 'met',
  );
  return (
    <div className="grid gap-3">
      <p className={textRole('body')}>
        Went live on <DisplayTime value={declaration.declared_implemented_at} dateOnly />
        {revisionNote(declaration.output_revision_id, shownRevision)}
      </p>
      <h3 ref={heading} tabIndex={-1} className={textRole('itemTitle', 'focus-ring w-fit')}>
        Measurement
      </h3>
      {declaration.checks.length === 0 ? (
        <p className={textRole('body')}>
          No automatic check applies to these findings, so CiteLadder records the work but cannot
          verify it.
        </p>
      ) : (
        <>
          <p className={textRole('body')} aria-live="polite">
            {IMPLEMENTATION_STATE_LABEL[declaration.state]}
          </p>
          <ul className="grid gap-2" aria-label="Checks">
            {declaration.checks.map((check) => (
              <CheckRow key={check.index} check={check} />
            ))}
          </ul>
        </>
      )}
      {declaration.legs.length > 0 ? (
        <ul className="grid gap-2" aria-label="Next readings">
          {declaration.legs.map((leg) => (
            <LegRow
              key={leg.leg}
              leg={leg}
              workspaceId={workspaceId}
              offerCrawl={leg.leg === 'next_crawl' && crawlOpen}
            />
          ))}
        </ul>
      ) : null}
      {declaration.checks.length > 0 ? (
        <p className={textRole('caption')}>
          New evidence is read until <DisplayTime value={declaration.measured_until} dateOnly />. A
          met check shows the change is live and measured; it does not prove this Action caused any
          movement, and other changes can overlap.
        </p>
      ) : null}
      <VerificationObservations implementation={declaration} showAuditLink={hasVisibility} />
    </div>
  );
}

const CHECK_TONE = { met: 'success', unmet: 'danger', unavailable: 'warning' } as const;

function CheckRow({ check }: Readonly<{ check: ActionDeclaration['checks'][number] }>) {
  const tone = check.state === 'waiting' ? null : CHECK_TONE[check.state];
  const reason = checkReasonLabel(check.reason);
  return (
    <li className="grid gap-0.5">
      <span className="flex flex-wrap items-center gap-2">
        <span className={textRole('itemTitle')}>{checkKindLabel(check.kind)}</span>
        {tone ? (
          <Badge variant="status" value={tone}>
            {CHECK_STATE_LABEL[check.state]}
          </Badge>
        ) : (
          <Badge>{CHECK_STATE_LABEL[check.state]}</Badge>
        )}
      </span>
      {check.subject ? <CheckSubject subject={check.subject} promptId={check.prompt_id} /> : null}
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
    </li>
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
}: Readonly<{ leg: MeasurementLeg; workspaceId: string; offerCrawl: boolean }>) {
  const owner = LEG_OWNER[leg.leg];
  const waiting = leg.state !== 'observed';
  return (
    <li className="grid gap-1">
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
    </li>
  );
}

/** Start the crawl a page check waits for, without leaving the Action. */
function RunCrawl({ workspaceId }: Readonly<{ workspaceId: string }>) {
  const { activeProjectId } = useProjectContext();
  const mayWrite = useWorkspaceCapability('write');
  const queryClient = useQueryClient();
  const start = useMutation({
    ...siteHealthMutations.createCrawl(workspaceId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.siteHealth.all }),
  });
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
    <div className="grid gap-2">
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
          notice={mutationNoticeForError(start.error, { action: 'start a crawl' })}
          onRetry={() => start.mutate({ project_id: activeProjectId })}
        />
      ) : null}
    </div>
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
