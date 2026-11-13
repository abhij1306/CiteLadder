import { ChevronDown } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { CrawlRobotsChoice, CrawlSchedule, CrawlScheduleCadence } from '@citeladder/contracts';

import { Button } from '@/components/ui/button';
import { DisplayTime } from '@/components/ui/display-time';
import { Icon } from '@/components/ui/icon';
import {
  Menu,
  MenuContent,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { robotsChoiceNote } from '@/components/site-health/robots-choice';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import type { ProjectScope } from '@/lib/api/query-keys/scope';
import { siteHealthMutations, siteHealthQueries } from '@/lib/api/site-health-queries';

type Choice = 'off' | CrawlScheduleCadence;

const CHOICES: ReadonlyArray<{ value: Choice; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const SKIPPED: Partial<Record<NonNullable<CrawlSchedule['last_outcome']>, string>> = {
  crawl_already_active: 'Last run skipped: a crawl was already running.',
  site_health_fetches_exhausted: 'Last run skipped: no page fetches left this period.',
  failed: 'Last run could not start a crawl. It will try again.',
};

/** The schedule turns itself off only after repeated failures; turning it off clears the outcome. */
const TURNED_OFF = 'Turned off: scheduled crawls kept failing to start.';

function choiceOf(schedule: CrawlSchedule | undefined): Choice {
  return schedule?.enabled ? schedule.cadence : 'off';
}

function outcomeNote(schedule: CrawlSchedule | undefined) {
  if (!schedule?.last_outcome) return null;
  if (schedule.enabled) return SKIPPED[schedule.last_outcome] ?? null;
  return schedule.last_outcome === 'failed' ? TURNED_OFF : null;
}

/**
 * Scheduled crawls beside Run new crawl: off, weekly or monthly. Each run
 * audits the tracked pages again with the newest crawl's robots choice, as the
 * crawl button does, and uses the
 * plan's page fetches like any crawl.
 */
function CrawlScheduleControl({
  schedule,
  unavailable,
  pending,
  robotsNote,
  onChange,
}: Readonly<{
  /** Undefined while the schedule loads or when it could not be read. */
  schedule: CrawlSchedule | undefined;
  /** The schedule could not be read. */
  unavailable: boolean;
  pending: boolean;
  /** The latest crawl ignores robots.txt, so scheduled runs do too; null otherwise. */
  robotsNote: string | null;
  onChange: (choice: Readonly<{ enabled: boolean; cadence: CrawlScheduleCadence }>) => void;
}>) {
  const current = choiceOf(schedule);
  const label = schedule
    ? (CHOICES.find((choice) => choice.value === current)?.label ?? 'Off')
    : null;
  let text = 'Schedule';
  if (pending) text = 'Saving…';
  else if (unavailable) text = 'Schedule unavailable';
  else if (label) text = `Schedule: ${label}`;
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="secondary"
          disabled={!schedule || pending}
          aria-label={label ? `Crawl schedule: ${label}` : text}
        >
          {text}
          <Icon icon={ChevronDown} />
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>Rerun the latest crawl automatically</MenuLabel>
        <MenuRadioGroup
          value={current}
          onValueChange={(next) => {
            const choice = CHOICES.find((option) => option.value === next)?.value;
            if (!choice || choice === current) return;
            onChange(
              choice === 'off'
                ? { enabled: false, cadence: schedule?.cadence ?? 'weekly' }
                : { enabled: true, cadence: choice },
            );
          }}
        >
          {CHOICES.map((choice) => (
            <MenuRadioItem key={choice.value} value={choice.value}>
              {choice.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <ScheduleNotes schedule={schedule} robotsNote={robotsNote} />
      </MenuContent>
    </Menu>
  );
}

/** Under the choices: the kept robots choice, the next run and the last outcome. */
function ScheduleNotes({
  schedule,
  robotsNote,
}: Readonly<{ schedule: CrawlSchedule | undefined; robotsNote: string | null }>) {
  const note = outcomeNote(schedule);
  if (!schedule?.enabled && !note && !robotsNote) return null;
  return (
    <>
      <MenuSeparator />
      {robotsNote ? <MenuLabel>{robotsNote}</MenuLabel> : null}
      {schedule?.enabled ? (
        <MenuLabel>
          Next crawl <DisplayTime value={schedule.next_run_at} dateOnly />
        </MenuLabel>
      ) : null}
      {note ? <MenuLabel>{note}</MenuLabel> : null}
    </>
  );
}

/**
 * The project's crawl schedule: the header control and, when saving failed, the
 * notice with its retry. Reads, and offers the control, only while `enabled`.
 */
export function useCrawlSchedule(
  scope: ProjectScope,
  enabled: boolean,
  /** The latest crawl's robots choice, which each scheduled run keeps. */
  robots: CrawlRobotsChoice | undefined,
) {
  const query = useQuery({ ...siteHealthQueries.crawlSchedule(scope), enabled });
  const mutation = useMutation(siteHealthMutations.updateCrawlSchedule(scope));
  const retry = () => {
    if (mutation.variables) mutation.mutate(mutation.variables);
  };
  return {
    control: enabled ? (
      <CrawlScheduleControl
        schedule={query.data}
        unavailable={query.isError}
        pending={mutation.isPending}
        robotsNote={robotsChoiceNote(robots)}
        onChange={(input) => mutation.mutate(input)}
      />
    ) : null,
    notice: mutation.isError ? (
      <MutationNotice
        notice={mutationNoticeForError(mutation.error, { action: 'save the crawl schedule' })}
        onRetry={retry}
      />
    ) : null,
  };
}
