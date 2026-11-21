import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { marketLabel } from '@citeladder/contracts/markets';
import type { ProbeQuote } from '@citeladder/contracts/probes';

import { InlineProviderSetup } from '@/components/runs/launch-dialog-view';
import { Absence } from '@/components/ui/absence';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FactList } from '@/components/ui/facts';
import { Stack } from '@/components/ui/layout';
import { Notice } from '@/components/ui/notice';
import { TextLink } from '@/components/ui/text-link';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { probeMutations, refreshProbeStatus } from '@/lib/api/probes';
import type { ProjectScope } from '@/lib/api/query-keys/scope';
import { PLANS_HREF } from '@/lib/billing/plan-limit';
import { formatCount } from '@/lib/format';
import { useEngineCatalog } from '@/lib/providers/engines';

export type ProbeIntent = { kind: 'run' } | { kind: 'schedule'; cadence: 'daily' | 'weekly' };

const COPY = {
  run: { title: 'Run a market probe', confirm: 'Run probe', action: 'run the probe', cost: 'Cost' },
  daily: {
    title: 'Probe every day',
    confirm: 'Probe daily',
    action: 'save the schedule',
    cost: 'Cost per run',
  },
  weekly: {
    title: 'Probe every week',
    confirm: 'Probe weekly',
    action: 'save the schedule',
    cost: 'Cost per run',
  },
} as const;

export function ProbeDialog({
  scope,
  quote,
  intent,
  onClose,
}: Readonly<{
  scope: ProjectScope;
  quote: ProbeQuote;
  intent: ProbeIntent | null;
  onClose: () => void;
}>) {
  const client = useQueryClient();
  const run = useMutation(probeMutations.run(scope));
  const schedule = useMutation(probeMutations.schedule(scope));
  const { label } = useEngineCatalog();
  const [connecting, setConnecting] = useState(true);
  const short = quote.balance !== null && quote.credits > quote.balance;
  const copy = COPY[intent?.kind === 'schedule' ? intent.cadence : 'run'];
  const pending = intent?.kind === 'schedule' ? schedule : run;
  const close = () => {
    run.reset();
    schedule.reset();
    setConnecting(true);
    onClose();
  };
  const confirm = () => {
    if (intent?.kind === 'schedule')
      schedule.mutate(
        { cadence: intent.cadence, fingerprint: quote.fingerprint },
        { onSuccess: close },
      );
    else run.mutate(quote.fingerprint, { onSuccess: close });
  };
  const facts = [
    { label: 'Engines', value: quote.engines.map(label).join(', ') },
    { label: 'Markets', value: quote.markets.map(marketLabel).join(', ') },
    {
      label: 'Questions',
      value: `${quote.questions} per engine in each market it can measure, asked ${quote.repetitions} times`,
    },
    { label: 'Answers', value: formatCount(quote.answers) },
    { label: copy.cost, value: <b>{formatCount(quote.credits)} AI credits</b> },
    {
      label: 'Balance after',
      value:
        quote.balance === null ? (
          <Absence state="unavailable" />
        ) : (
          `${formatCount(quote.balance - quote.credits)} of ${formatCount(quote.balance)}`
        ),
    },
  ];
  return (
    <Dialog
      open={intent !== null}
      onOpenChange={(next) => (next ? undefined : close())}
      title={copy.title}
      description="Each engine answers what you're known for, which brands lead each theme, and why a buyer might not choose you."
      footer={
        <>
          <Button variant="quiet" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={quote.blocked !== null || short}
            pending={pending.isPending}
            onClick={confirm}
          >
            {copy.confirm}
          </Button>
        </>
      }
    >
      <Stack gap="item">
        {pending.isError ? (
          <Notice
            kind="mutation"
            notice={mutationNoticeForError(pending.error, { action: copy.action })}
          />
        ) : null}
        {short ? (
          <Notice tone="warning" action={<TextLink href={PLANS_HREF}>See plans</TextLink>}>
            Not enough AI credits.
          </Notice>
        ) : null}
        <Blocked
          blocked={quote.blocked}
          connecting={connecting}
          onConnected={() => {
            setConnecting(false);
            refreshProbeStatus(client, scope);
          }}
        />
        {quote.blocked === null ? <FactList facts={facts} layout="ruled" /> : null}
      </Stack>
    </Dialog>
  );
}

function Blocked({
  blocked,
  connecting,
  onConnected,
}: Readonly<{
  blocked: ProbeQuote['blocked'];
  connecting: boolean;
  onConnected: () => void;
}>) {
  switch (blocked) {
    case null:
      return null;
    case 'trial':
      return (
        <Notice tone="info" action={<TextLink href={PLANS_HREF}>See plans</TextLink>}>
          Market probes are not in the trial.
        </Notice>
      );
    case 'task_limit':
      return (
        <Notice tone="info">
          This probe asks more questions than one run allows. Remove a theme to run it.
        </Notice>
      );
    case 'no_key':
      return (
        <>
          <Notice tone="info">Add a key for an engine that searches.</Notice>
          {connecting ? <InlineProviderSetup connecting="any" onClose={onConnected} /> : null}
        </>
      );
    case 'no_market':
      return (
        <Notice tone="info">
          None of your engines can measure this project&apos;s markets. Add a market they support.
        </Notice>
      );
    default: {
      const unreachable: never = blocked;
      return unreachable;
    }
  }
}
