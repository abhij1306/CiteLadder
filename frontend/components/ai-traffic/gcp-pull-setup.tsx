'use client';
import type { z } from 'zod';
import type { crawlSourceListSchema, crawlSourceSchema } from '@citeladder/contracts/ai-traffic';
import type { useCrawlConnections } from '@/lib/ai-traffic/use-crawl-connections';
import { useGcpPullActions } from '@/lib/ai-traffic/use-gcp-pull';
import { gcpSetupCommands } from '@/lib/ai-traffic/gcp-commands';
import { verificationFailureLabel } from '@/lib/ai-traffic/vocabulary';
import { GCP_PULL_SETUP } from '@/lib/config/crawl-logs';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { panelClasses } from '@/components/ui/panel';

type Source = z.infer<typeof crawlSourceSchema>;
type GcpPull = z.infer<typeof crawlSourceListSchema>['gcp_pull'];

/** Copyable preformatted text: generated commands or the sink filter. */
function CodeText({ value, label }: Readonly<{ value: string; label: string }>) {
  return (
    <div className="grid gap-2">
      <pre
        className={panelClasses(
          { tone: 'well', pad: 'compact' },
          'type-caption overflow-x-auto font-mono break-all whitespace-pre-wrap',
        )}
      >
        {value}
      </pre>
      <CopyButton value={value} className="w-fit">
        {label}
      </CopyButton>
    </div>
  );
}

/** The subscription CiteLadder pulls and the load balancer sample rate the customer set. */
export function GcpFields({ model }: Readonly<{ model: ReturnType<typeof useCrawlConnections> }>) {
  const { subscription, setSubscription, sampleRate, setSampleRate } = model;
  return (
    <>
      <Field
        label="Pub/Sub subscription"
        hint="The full path. The commands shown after you create the source create it."
        className="sm:col-span-2"
      >
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
        hint="Between 0.001 and 1, as set on the backend service. Below 1, coverage stays partial."
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

/** What the setup involves before the source, and its label nonce, exist. */
export function GcpSteps() {
  return (
    <p className="type-body text-secondary">
      CiteLadder pulls a Pub/Sub subscription in your Google Cloud project that a Cloud Logging sink
      fills with crawler requests to your load balancer or Cloud Run services. Create the source
      first: the setup commands then include its verification label. You pay Google for log routing
      and Pub/Sub, which the crawler-only filter keeps small.
    </p>
  );
}

/** The created source's setup commands and its subscription check. */
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
    <div className="grid gap-3">
      <p className="type-body">
        Run these in Cloud Shell, then enable logging on each load balancer backend service. The
        label lets CiteLadder confirm the subscription is yours.
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
        className="w-fit"
        pending={verify.isPending}
        pendingLabel="Checking…"
        onClick={() => verify.mutate(source.id)}
      >
        Verify subscription
      </Button>
      {outcome?.verified ? (
        <Alert tone="success">Verified. CiteLadder pulls the subscription every few minutes.</Alert>
      ) : null}
      {outcome && !outcome.verified ? (
        <Alert tone="danger">{verificationFailureLabel(outcome.failure ?? 'unavailable')}</Alert>
      ) : null}
      {verify.isError ? <Alert tone="danger">{verify.error.message}</Alert> : null}
    </div>
  );
}

/** The crawler catalog changed: each live pull source still on an older filter asks for it. */
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
  const { confirmFilter } = useGcpPullActions(projectId, workspaceId);
  const outdated = data.items.filter(
    (s) => s.pull && !s.pull.filter_current && s.status === 'active',
  );
  return outdated.map((source) => (
    <SinkFilterUpdate
      key={source.id}
      source={source}
      gcp={data.gcp_pull}
      canManage={canManage}
      confirmFilter={confirmFilter}
    />
  ));
}
function SinkFilterUpdate({
  source,
  gcp,
  canManage,
  confirmFilter,
}: Readonly<{
  source: Source;
  gcp: GcpPull;
  canManage: boolean;
  confirmFilter: ReturnType<typeof useGcpPullActions>['confirmFilter'];
}>) {
  return (
    <section className="grid gap-2" aria-label={`Sink filter update for ${source.host}`}>
      <Alert tone="warning">
        Update your sink filter. CiteLadder recognizes new crawlers; until the sink uses this
        filter, coverage stays partial.
      </Alert>
      <CodeText label="Copy filter" value={gcp.log_filter} />
      {canManage ? (
        <Button
          size="sm"
          variant="secondary"
          className="w-fit"
          pending={confirmFilter.isPending}
          onClick={() => confirmFilter.mutate(source.id)}
        >
          I’ve updated it
        </Button>
      ) : null}
      {confirmFilter.isError ? <Alert tone="danger">{confirmFilter.error.message}</Alert> : null}
    </section>
  );
}
