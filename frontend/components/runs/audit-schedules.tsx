'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { QueryState } from '@/components/ui/query-state';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { Select } from '@/components/ui/select';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { queryKeys } from '@/lib/api/query-keys';
import { runsApi } from '@/lib/api/runs';
import { toggleMarket } from '@/lib/runs/launch';
import type { ProjectMarket } from '@citeladder/contracts/markets';
import type {
  AuditSchedule,
  AuditScheduleCadence,
  LogicalEngine,
  PromptSet,
} from '@/lib/api/types';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { DisplayTime } from '@/components/ui/display-time';
import { textRole } from '@/components/ui/typography';
import { Inline, Stack } from '@/components/ui/layout';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { useActiveWorkspaceId } from '@/lib/project/project-context';
import { useProjectMarkets } from '@/lib/project/use-project-markets';
import { ENGINE_ORDER, ENGINE_LABELS } from '@/lib/providers/catalog';
import { schedulePauseReason } from '@/lib/runs/status';

const CADENCE_LABELS: Record<AuditScheduleCadence, string> = {
  one_time: 'One time',
  every_n_minutes: 'Every N minutes',
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
};

function useAuditSchedules(projectId: string | null) {
  const workspaceId = useActiveWorkspaceId();
  return useQuery({
    queryKey: queryKeys.runs.schedules(workspaceId, projectId ?? ''),
    queryFn: ({ signal }) => runsApi.listSchedules(projectId!, { signal, workspaceId }),
    enabled: Boolean(projectId && workspaceId),
  });
}

/** Compact schedule ledger: schedules use the same frozen prompt set and engines as a run. */
export function AuditSchedules({
  projectId,
  promptSets,
}: Readonly<{ projectId: string; promptSets: PromptSet[] }>) {
  const workspaceId = useActiveWorkspaceId();
  if (!workspaceId) return <Alert tone="info">Loading your workspace…</Alert>;
  return (
    <WorkspaceSchedules
      key={`${workspaceId}:${projectId}`}
      workspaceId={workspaceId}
      projectId={projectId}
      promptSets={promptSets}
    />
  );
}

function WorkspaceSchedules({
  workspaceId,
  projectId,
  promptSets,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  promptSets: PromptSet[];
}>) {
  const queryClient = useQueryClient();
  const [promptSetId, setPromptSetId] = useState(promptSets[0]?.id ?? '');
  const [auditScope, setAuditScope] = useState<'brand' | 'commerce'>('brand');
  const [cadence, setCadence] = useState<AuditScheduleCadence>('weekly');
  const [intervalMinutes, setIntervalMinutes] = useState('60');
  const [engines, setEngines] = useState<LogicalEngine[]>(['chatgpt']);
  const [marketIds, setMarketIds] = useState<(string | null)[]>([null]);
  const schedulesQuery = useAuditSchedules(projectId);
  const markets = useProjectMarkets(projectId, workspaceId);
  const createMutation = useMutation({
    mutationFn: () => {
      return runsApi.createSchedule(
        projectId,
        {
          prompt_set_id: promptSetId,
          audit_scope: auditScope,
          cadence,
          interval_minutes: cadence === 'every_n_minutes' ? Number(intervalMinutes) : undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          engines,
          market_ids: marketIds,
        },
        { workspaceId },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.runs.schedules(workspaceId, projectId),
      });
    },
  });
  const canCreate = !createMutation.isPending && scheduleReady(promptSetId, engines, marketIds);
  const resumeMutation = useMutation({
    mutationFn: (scheduleId: string) =>
      runsApi.updateSchedule(projectId, scheduleId, { enabled: true }, { workspaceId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.runs.schedules(workspaceId, projectId),
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scheduled audits</CardTitle>
        <p className="type-caption">Runs use the selected prompt set and your connected engines.</p>
      </CardHeader>
      <CardContent>
        <Stack>
          {schedulesQuery.isError ? (
            <ReadError
              {...readErrorProps(schedulesQuery)}
              fallback="Could not load scheduled audits."
            />
          ) : null}
          {schedulesQuery.data?.length ? (
            <ul className={ledgerClasses('boxed')}>
              {schedulesQuery.data.map((schedule) => (
                <ScheduleRow
                  key={schedule.id}
                  schedule={schedule}
                  markets={markets}
                  resuming={resumeMutation.isPending}
                  onResume={() => resumeMutation.mutate(schedule.id)}
                />
              ))}
            </ul>
          ) : null}
          {schedulesQuery.isSuccess && schedulesQuery.data.length === 0 ? (
            <QueryState kind="empty" inline message="No scheduled audits yet." />
          ) : null}
          {promptSets.length === 0 ? (
            <Alert tone="info">Add prompts before scheduling an audit.</Alert>
          ) : (
            <Stack className="desktop:grid-cols-3">
              <Stack gap="item" className={textRole('label')}>
                <span>Prompt set</span>
                <Select
                  ariaLabel="Prompt set"
                  value={promptSetId}
                  onValueChange={setPromptSetId}
                  options={promptSets.map((set) => ({ value: set.id, label: set.name }))}
                />
              </Stack>
              <Stack gap="item" className={textRole('label')}>
                <span>Measurement scope</span>
                <Select
                  ariaLabel="Measurement scope"
                  value={auditScope}
                  onValueChange={setAuditScope}
                  options={[
                    { value: 'brand', label: 'Brand visibility' },
                    { value: 'commerce', label: 'Commerce AI Shelf' },
                  ]}
                />
              </Stack>
              <Stack gap="item" className={textRole('label')}>
                <span>Cadence</span>
                <Select
                  ariaLabel="Cadence"
                  value={cadence}
                  onValueChange={setCadence}
                  options={Object.entries(CADENCE_LABELS).map(([value, label]) => ({
                    value: value as AuditScheduleCadence,
                    label,
                  }))}
                />
              </Stack>
              {cadence === 'every_n_minutes' ? (
                <label htmlFor="audit-schedule-minutes" className={textRole('label')}>
                  <Stack as="span" gap="item">
                    <span>Minutes</span>
                    <Input
                      id="audit-schedule-minutes"
                      min="5"
                      type="number"
                      value={intervalMinutes}
                      onChange={(event) => setIntervalMinutes(event.target.value)}
                    />
                  </Stack>
                </label>
              ) : null}
              <Stack as="fieldset" gap="item" className="desktop:col-span-2">
                <legend className={textRole('label')}>Engines</legend>
                <Inline className="flex-wrap">
                  {ENGINE_ORDER.map((engine) => (
                    <Checkbox
                      key={engine}
                      label={ENGINE_LABELS[engine]}
                      checked={engines.includes(engine)}
                      onCheckedChange={() =>
                        setEngines((current) =>
                          current.includes(engine)
                            ? current.filter((value) => value !== engine)
                            : [...current, engine],
                        )
                      }
                    />
                  ))}
                </Inline>
              </Stack>
              <MarketChecklist markets={markets} marketIds={marketIds} onToggle={setMarketIds} />
              <div className="flex items-end">
                <Button onClick={() => createMutation.mutate()} disabled={!canCreate}>
                  {createMutation.isPending ? 'Scheduling…' : 'Schedule audit'}
                </Button>
              </div>
            </Stack>
          )}
          {createMutation.isError ? (
            <MutationNotice
              notice={mutationNoticeForError(createMutation.error, {
                action: 'schedule the audit',
              })}
              onRetry={() => createMutation.mutate()}
            />
          ) : null}
          <ResumeNotice
            error={resumeMutation.error}
            onRetry={() => resumeMutation.mutate(resumeMutation.variables!)}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}

const scheduleReady = (
  promptSetId: string,
  engines: readonly LogicalEngine[],
  marketIds: readonly (string | null)[],
) => Boolean(promptSetId) && engines.length > 0 && marketIds.length > 0;

/** Which markets each occurrence measures; offered once a project has more than its default. */
function MarketChecklist({
  markets,
  marketIds,
  onToggle,
}: Readonly<{
  markets: readonly ProjectMarket[];
  marketIds: (string | null)[];
  onToggle: React.Dispatch<React.SetStateAction<(string | null)[]>>;
}>) {
  if (markets.length < 2) return null;
  return (
    <Stack as="fieldset" gap="item" className="desktop:col-span-2">
      <legend className={textRole('label')}>Markets</legend>
      <Inline className="flex-wrap">
        {markets.map((market) => (
          <Checkbox
            key={market.id ?? 'default'}
            label={market.label}
            checked={marketIds.includes(market.id)}
            onCheckedChange={() => onToggle((current) => toggleMarket(current, market.id))}
          />
        ))}
      </Inline>
    </Stack>
  );
}

const finishedOnce = (schedule: AuditSchedule) =>
  schedule.cadence === 'one_time' && !schedule.next_run_at && !schedule.failure_count;

function pauseLabel(schedule: AuditSchedule) {
  if (finishedOnce(schedule)) return 'Ran once.';
  return schedule.failure_count
    ? `Paused: ${schedulePauseReason(schedule.last_error)}.`
    : 'Paused.';
}

/** The schedule's markets by label, or nothing while the project has only its default. */
function marketSummary(schedule: AuditSchedule, markets: readonly ProjectMarket[]): string {
  if (markets.length < 2) return '';
  const labels = schedule.market_ids.map(
    (id) => markets.find((market) => market.id === id)?.label ?? 'Removed market',
  );
  return ` · ${labels.join(', ')}`;
}

function ScheduleRow({
  schedule,
  markets,
  resuming,
  onResume,
}: Readonly<{
  schedule: AuditSchedule;
  markets: readonly ProjectMarket[];
  resuming: boolean;
  onResume: () => void;
}>) {
  return (
    <Inline as="li" className={ledgerItemClasses('type-body flex-wrap justify-between')}>
      <span className={textRole('emphasis', 'text-foreground')}>
        {CADENCE_LABELS[schedule.cadence]}
      </span>
      {schedule.enabled ? (
        <span className="text-secondary">
          {schedule.engines.join(', ')} · next{' '}
          {schedule.next_run_at ? (
            <DisplayTime value={schedule.next_run_at} />
          ) : (
            <UnavailableValue state="not_set" />
          )}
          {' · '}
          {schedule.audit_scope === 'commerce' ? 'Commerce' : 'Brand'}
          {marketSummary(schedule, markets)}
        </span>
      ) : (
        <Inline as="span" className="text-secondary flex-wrap">
          {pauseLabel(schedule)}
          {/* A one-time schedule that ran is finished, not paused; resuming would run it again. */}
          {finishedOnce(schedule) ? null : (
            <Button variant="secondary" disabled={resuming} onClick={onResume}>
              Resume
            </Button>
          )}
        </Inline>
      )}
    </Inline>
  );
}

function ResumeNotice({ error, onRetry }: Readonly<{ error: Error | null; onRetry: () => void }>) {
  if (!error) return null;
  return (
    <MutationNotice
      notice={mutationNoticeForError(error, { action: 'resume the schedule' })}
      onRetry={onRetry}
    />
  );
}
