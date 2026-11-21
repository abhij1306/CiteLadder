import type { z } from 'zod';
import type { crawlSourceListSchema, crawlSourceSchema } from '@citeladder/contracts/ai-traffic';
import type { useCrawlConnections } from '@/lib/ai-traffic/use-crawl-connections';
import { useGcpPullActions } from '@/lib/ai-traffic/use-gcp-pull';
import { gcpSetupCommands } from '@/lib/ai-traffic/gcp-commands';
import { verificationFailureLabel } from '@/lib/ai-traffic/vocabulary';
import { GCP_PULL_SETUP } from '@/lib/config/crawl-logs';
import { Button } from '@/components/ui/button';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { CopyButton } from '@/components/ui/copy-button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { Notice } from '@/components/ui/notice';
import { wellClasses } from '@/components/ui/slip';

type Source = z.infer<typeof crawlSourceSchema>;
type GcpPull = z.infer<typeof crawlSourceListSchema>['gcp_pull'];

function CodeText({ value, label }: Readonly<{ value: string; label: string }>) {
  return (
    <Stack>
      <pre className={wellClasses('type-code overflow-x-auto break-all whitespace-pre-wrap')}>
        {value}
      </pre>
      <CopyButton value={value} className="w-fit">
        {label}
      </CopyButton>
    </Stack>
  );
}

export function GcpFields({ model }: Readonly<{ model: ReturnType<typeof useCrawlConnections> }>) {
  const { subscription, setSubscription, sampleRate, setSampleRate } = model;
  return (
    <>
      <Field label="Pub/Sub subscription" hint="Full path" className="desktop:col-span-2">
        {(field) => (
          <Input
            {...field}
            placeholder={GCP_PULL_SETUP.subscriptionPlaceholder}
            value={subscription}
            onChange={(e) => setSubscription(e.target.value)}
          />
        )}
      </Field>
      <Field
        label="Load balancer logging sample rate"
        hint="0.001–1, as set on the backend service. Below 1, coverage stays partial."
      >
        {(field) => (
          <Input
            {...field}
            inputMode="decimal"
            value={sampleRate}
            onChange={(e) => setSampleRate(e.target.value)}
          />
        )}
      </Field>
    </>
  );
}

export function GcpSteps() {
  return (
    <p className="type-body text-ink-2">
      Create the source first to get its setup commands. You pay Google for log routing and Pub/Sub.
    </p>
  );
}

export function GcpSourceSetup({
  source,
  gcp,
  projectId,
  workspaceId,
}: Readonly<{ source: Source; gcp: GcpPull; projectId: string; workspaceId: string }>) {
  const { verify } = useGcpPullActions(projectId, workspaceId);
  const pull = source.pull;
  if (!pull || !gcp.reader_email) return null;
  const outcome = verify.data;
  return (
    <Stack>
      <p className="type-body text-ink-2">
        Run these in Cloud Shell, then enable logging on each load balancer backend service.
      </p>
      <CodeText
        label="Copy commands"
        value={gcpSetupCommands({
          subscription: pull.subscription,
          nonce: pull.verification_nonce,
          readerEmail: gcp.reader_email,
          logFilter: gcp.log_filter,
          sampleRate: pull.declared_sample_rate,
        })}
      />
      <Button
        variant="secondary"
        className="w-fit"
        pending={verify.isPending}
        pendingLabel="Checking…"
        onClick={() => verify.mutate(source.id)}
      >
        Verify subscription
      </Button>
      {outcome?.verified ? <Notice tone="positive">Verified.</Notice> : null}
      {outcome && !outcome.verified ? (
        <Notice tone="negative">
          {verificationFailureLabel(outcome.failure ?? 'unavailable')}
        </Notice>
      ) : null}
      {verify.isError ? (
        <Notice
          kind="mutation"
          notice={mutationNoticeForError(verify.error, { action: 'verify the subscription' })}
          onRetry={() => verify.mutate(source.id)}
        />
      ) : null}
    </Stack>
  );
}

export function SinkFilterUpdates({
  data,
  projectId,
  workspaceId,
  canManage,
}: Readonly<{
  data: z.infer<typeof crawlSourceListSchema>;
  projectId: string;
  workspaceId: string;
  canManage: boolean;
}>) {
  const outdated = data.items.filter(
    (s) => s.pull && !s.pull.filter_current && s.status === 'active',
  );
  return outdated.map((source) => (
    <SinkFilterUpdate
      key={source.id}
      source={source}
      gcp={data.gcp_pull}
      projectId={projectId}
      workspaceId={workspaceId}
      canManage={canManage}
    />
  ));
}
function SinkFilterUpdate({
  source,
  gcp,
  projectId,
  workspaceId,
  canManage,
}: Readonly<{
  source: Source;
  gcp: GcpPull;
  projectId: string;
  workspaceId: string;
  canManage: boolean;
}>) {
  const { confirmFilter } = useGcpPullActions(projectId, workspaceId);
  return (
    <Stack as="section" aria-label={`Sink filter update for ${source.host}`}>
      <Notice tone="warning">Update your sink filter. Until then, coverage stays partial.</Notice>
      <CodeText label="Copy filter" value={gcp.log_filter} />
      {canManage ? (
        <Button
          variant="secondary"
          className="w-fit"
          pending={confirmFilter.isPending}
          onClick={() => confirmFilter.mutate(source.id)}
        >
          I’ve updated it
        </Button>
      ) : null}
      {confirmFilter.isError ? (
        <Notice
          kind="mutation"
          notice={mutationNoticeForError(confirmFilter.error, {
            action: 'confirm the sink filter',
          })}
          onRetry={() => confirmFilter.mutate(source.id)}
        />
      ) : null}
    </Stack>
  );
}
