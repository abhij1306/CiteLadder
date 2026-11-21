import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import type { ProbeStatus } from '@citeladder/contracts/probes';

import { PerceptionMarket } from '@/components/perception/perception-market';
import { PerceptionObjections } from '@/components/perception/perception-objections';
import { ProbeBar, ProbeEmpty } from '@/components/perception/probe-bar';
import { ProbeDialog, type ProbeIntent } from '@/components/perception/probe-dialog';
import { readErrorProps } from '@/components/ui/notice';
import { SectionStack } from '@/components/ui/section';
import { StateBlock } from '@/components/ui/state-block';
import { probeBasis, probeQueries, refreshProbeStatus } from '@/lib/api/probes';
import { useProjectScope } from '@/lib/project/active-project-scope';

type ProbeView = 'market' | 'objections';

export function PerceptionProbe({ view }: Readonly<{ view: ProbeView }>) {
  const { workspaceId, projectId } = useProjectScope();
  const scope = { workspaceId, projectId };
  const client = useQueryClient();
  const status = useQuery(probeQueries.status(scope));
  const [intent, setIntent] = useState<ProbeIntent | null>(null);
  const basis = probeBasis(status.data);
  const market = useQuery({
    ...probeQueries.market(scope, basis),
    enabled: status.isSuccess && view === 'market',
  });
  const objections = useQuery({
    ...probeQueries.objections(scope, basis),
    enabled: status.isSuccess && view === 'objections',
  });
  if (status.isPending)
    return (
      <StateBlock kind="loading" label="Loading the market probe…" shape={{ kind: 'figures' }} />
    );
  if (status.isError)
    return (
      <StateBlock
        kind="error"
        {...readErrorProps(status)}
        title="Couldn't load the market probe"
        fallback="Check your connection and try again."
      />
    );
  const confirm = (next: ProbeIntent) => {
    refreshProbeStatus(client, scope);
    setIntent(next);
  };
  const onRun = () => confirm({ kind: 'run' });
  return (
    <SectionStack>
      <ProbeBar
        scope={scope}
        status={status.data}
        onRun={onRun}
        onSchedule={(cadence) => confirm({ kind: 'schedule', cadence })}
      />
      {view === 'market' ? (
        <ProbeRead
          read={market}
          title="Couldn't load Market"
          status={status.data}
          onRun={onRun}
          render={(data) => <PerceptionMarket scope={scope} data={data} />}
        />
      ) : (
        <ProbeRead
          read={objections}
          title="Couldn't load objections"
          status={status.data}
          onRun={onRun}
          render={(data) => <PerceptionObjections scope={scope} data={data} />}
        />
      )}
      <ProbeDialog
        scope={scope}
        quote={status.data.quote}
        intent={intent}
        onClose={() => setIntent(null)}
      />
    </SectionStack>
  );
}

function ProbeRead<Value>({
  read,
  title,
  status,
  onRun,
  render,
}: Readonly<{
  read: UseQueryResult<{ state: 'none' } | ({ state: 'value' } & Value)>;
  title: string;
  status: ProbeStatus;
  onRun: () => void;
  render: (data: { state: 'value' } & Value) => ReactNode;
}>) {
  if (read.isSuccess && read.data.state === 'value') return render(read.data);
  if (read.isPending)
    return <StateBlock kind="loading" label="Loading…" shape={{ kind: 'figures' }} />;
  if (read.isError)
    return (
      <StateBlock
        kind="error"
        {...readErrorProps(read)}
        title={title}
        fallback="Check your connection and try again."
      />
    );
  return <ProbeEmpty status={status} onRun={onRun} />;
}
