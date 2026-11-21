import { useIsFetching, useMutation } from '@tanstack/react-query';

import type { ProbeRun, ProbeStatus } from '@citeladder/contracts/probes';

import { Button } from '@/components/ui/button';
import { Inline, Stack } from '@/components/ui/layout';
import { Notice } from '@/components/ui/notice';
import { Section } from '@/components/ui/section';
import { Select } from '@/components/ui/select';
import { StateBlock } from '@/components/ui/state-block';
import { textRole } from '@/components/ui/typography';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { probeBusy, probeMutations } from '@/lib/api/probes';
import { queryKeys } from '@/lib/api/query-keys';
import type { ProjectScope } from '@/lib/api/query-keys/scope';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayDate, pluralCount } from '@/lib/format';
import { useWorkspaceCapability } from '@/lib/project/project-scope';

type Cadence = 'off' | 'daily' | 'weekly';

const CADENCES = [
  { value: 'off', label: 'Off' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
] as const satisfies readonly { value: Cadence; label: string }[];

function cadenceOf(schedule: ProbeStatus['schedule']): Cadence {
  if (!schedule?.enabled) return 'off';
  return schedule.cadence === 'daily' || schedule.cadence === 'weekly' ? schedule.cadence : 'off';
}

function lastRun(run: ProbeRun | null, date: (iso: string) => string): string {
  if (!run) return 'Not run yet';
  const scope = `${pluralCount(run.engines.length, 'engine')} · ${pluralCount(run.markets.length, 'market')}`;
  switch (run.state) {
    case 'running':
      return `Running · ${scope}`;
    case 'labelling':
      return `Labelling ${pluralCount(run.answers, 'answer')}`;
    case 'ready':
      return `Last run ${date(run.created_at)} · ${scope} · ${pluralCount(run.answers, 'answer')}`;
    case 'failed':
      return `Last probe failed · ${date(run.created_at)}`;
    case 'unavailable':
      return `Last probe couldn't be labelled · ${date(run.created_at)}`;
    default: {
      const unreachable: never = run.state;
      return unreachable;
    }
  }
}

export function ProbeBar({
  scope,
  status,
  onRun,
  onSchedule,
}: Readonly<{
  scope: ProjectScope;
  status: ProbeStatus;
  onRun: () => void;
  onSchedule: (cadence: 'daily' | 'weekly') => void;
}>) {
  const timeZone = useDisplayTimeZone();
  const mayRun = useWorkspaceCapability('run');
  const mayWrite = useWorkspaceCapability('write');
  const schedule = useMutation(probeMutations.schedule(scope));
  const refreshing = useIsFetching({ queryKey: queryKeys.projects.probes(scope) }) > 0;
  return (
    <Section variant="framed">
      <Stack gap="item">
        <Inline className="flex-wrap justify-between">
          <Stack gap="tight">
            <p className={textRole('label')}>Market probe</p>
            <p className={textRole('caption', 'text-ink-2')}>
              {lastRun(status.latest, (iso) => formatDisplayDate(iso, timeZone))}
            </p>
          </Stack>
          <Inline>
            <Select<Cadence>
              ariaLabel="Probe schedule"
              value={cadenceOf(status.schedule)}
              options={CADENCES}
              disabled={!mayWrite || schedule.isPending}
              onValueChange={(cadence) =>
                cadence === 'off' ? schedule.mutate({ cadence: null }) : onSchedule(cadence)
              }
            />
            <Button
              variant="primary"
              disabled={!mayRun || refreshing || probeBusy(status)}
              onClick={onRun}
            >
              Run probe
            </Button>
          </Inline>
        </Inline>
        {schedule.isError ? (
          <Notice
            kind="mutation"
            notice={mutationNoticeForError(schedule.error, { action: 'save the schedule' })}
          />
        ) : null}
      </Stack>
    </Section>
  );
}

export function ProbeEmpty({
  status,
  onRun,
}: Readonly<{ status: ProbeStatus; onRun: () => void }>) {
  const mayRun = useWorkspaceCapability('run');
  if (probeBusy(status))
    return (
      <StateBlock
        kind="empty"
        heading="Probe running"
        description="Results appear when it finishes."
      />
    );
  const failed = status.latest?.state === 'failed' || status.latest?.state === 'unavailable';
  return (
    <StateBlock
      kind="empty"
      heading={failed ? "The last probe couldn't finish" : 'No market probe yet'}
      description="A probe asks each engine what you're known for, which brands lead each theme, and why a buyer might not choose you. It's paid from your AI credits."
      action={mayRun ? <Button onClick={onRun}>Run probe</Button> : undefined}
    />
  );
}
