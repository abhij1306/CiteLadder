'use client';
import { useId } from 'react';
import {
  collectionPointLabel,
  COLLECTION_POINTS,
  LOG_FORMATS,
  logFormatLabel,
} from '@/lib/ai-traffic/vocabulary';
import type { useCrawlConnections } from '@/lib/ai-traffic/use-crawl-connections';
import {
  CLOUDFRONT_LOG_FIELDS,
  CRAWL_LOG_SETUPS,
  CRAWL_INGEST_ORIGIN,
  FIREHOSE_BUFFER_INTERVAL,
  FIREHOSE_FILTER_TEMPLATE,
} from '@/lib/config/crawl-logs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Stack } from '@/components/ui/layout';
import { panelClasses } from '@/components/ui/panel';
import { RadioGroup } from '@/components/ui/radio-group';
import { Alert } from '@/components/ui/alert';
import { CopyButton } from '@/components/ui/copy-button';
import { TextLink } from '@/components/ui/text-link';
import { Checkbox } from '@/components/ui/checkbox';
import { GcpFields, GcpSourceSetup, GcpSteps } from './gcp-pull-setup';
const SETUP_STEPS: Partial<Record<(typeof CRAWL_LOG_SETUPS)[number]['value'], string>> = {
  cloudflare_worker:
    'Deploy the downloadable template yourself. Store the token as a Worker secret, use a fail-open route, and expect partial coverage. Every routed request uses your Workers quota.',
  cloudflare_logpush:
    'Select HTTP requests, the documented field list and RFC3339 timestamps. Set the Authorization header in the HTTP destination and bound batches to the documented limits. Logpush can reach complete coverage only with unsampled delivery and heartbeats.',
  custom:
    'Map timestamp, host, path, method, status and user_agent to the documented JSON fields. Batch at least 60 seconds apart; send empty heartbeat batches when no crawler requests occur.',
};
export function CrawlLogSetup({
  model,
}: Readonly<{ model: ReturnType<typeof useCrawlConnections> }>) {
  const { setup, setSetup, origin, setOrigin, setSampling, setFilter, setPoint, mutation } = model;
  const chosen = CRAWL_LOG_SETUPS.find((s) => s.value === setup)!;
  const steps = SETUP_STEPS[chosen.value];
  const firehose = setup === 'aws_firehose';
  const gcp = setup === 'gcp_pubsub_pull';
  // Without a reader service account (local development) the pull connector cannot run.
  const pullUnavailable = model.sources.data?.gcp_pull.availability !== 'available';
  let fields = <DeclaredFields model={model} />;
  if (firehose) fields = <FirehoseFields model={model} />;
  if (gcp) fields = <GcpFields model={model} />;
  return (
    <Stack gap="section">
      <RadioGroup
        variant="row"
        ariaLabel="Collection method"
        value={setup}
        onValueChange={(value) => {
          const next = CRAWL_LOG_SETUPS.find((s) => s.value === value)!;
          setSetup(next.value);
          setPoint(next.collectionPoint);
          setSampling(next.value === 'cloudflare_worker' ? 'filtered' : 'none');
          setFilter(
            next.value === 'cloudflare_worker' ? 'Best-effort recognized automated requests' : '',
          );
        }}
        options={CRAWL_LOG_SETUPS.map((s) => {
          const unavailable = s.value === 'gcp_pubsub_pull' && pullUnavailable;
          return {
            value: s.value,
            disabled: unavailable,
            label: (
              <span className="grid gap-0.5 py-2">
                <span className="type-control text-foreground">{s.label}</span>
                <span className="type-caption">
                  {unavailable ? 'Not available in this environment.' : s.description}
                </span>
              </span>
            ),
          };
        })}
      />
      <div className={panelClasses({ tone: 'well', pad: 'compact' }, 'grid gap-2')}>
        {steps ? <p className="type-body text-secondary">{steps}</p> : null}
        {firehose ? <FirehoseSteps interval={model.bufferInterval} /> : null}
        {gcp ? <GcpSteps /> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Site origin" className="sm:col-span-2">
          {(field) => (
            <Input {...field} value={origin} onChange={(e) => setOrigin(e.target.value)} />
          )}
        </Field>
        {fields}
      </div>
      {mutation.isError ? <Alert tone="danger">{mutation.error.message}</Alert> : null}
      {setup === 'upload' ? <UploadForm model={model} /> : null}
    </Stack>
  );
}
/** Format, collection point and sampling a custom sender declares; Firehose fixes all three. */
function DeclaredFields({ model }: Readonly<{ model: ReturnType<typeof useCrawlConnections> }>) {
  const { format, setFormat, point, setPoint, sampling, setSampling, rate, setRate } = model;
  const { filter, setFilter } = model;
  return (
    <>
      <Field label="Log format">
        {({ id }) => (
          <Select
            id={id}
            ariaLabel="Log format"
            value={format}
            onValueChange={setFormat}
            options={LOG_FORMATS.map((value) => ({ value, label: logFormatLabel(value) }))}
          />
        )}
      </Field>
      <Field label="Collection point">
        {({ id }) => (
          <Select
            id={id}
            ariaLabel="Collection point"
            value={point}
            onValueChange={setPoint}
            options={COLLECTION_POINTS.map((value) => ({
              value,
              label: collectionPointLabel(value),
            }))}
          />
        )}
      </Field>
      <Field label="Sampling">
        {({ id }) => (
          <Select
            id={id}
            ariaLabel="Sampling"
            value={sampling}
            onValueChange={setSampling}
            options={[
              { value: 'none', label: 'Unsampled' },
              { value: 'sampled', label: 'Sampled' },
              { value: 'filtered', label: 'Filtered' },
            ]}
          />
        )}
      </Field>
      {sampling === 'sampled' ? (
        <Field label="Sampling rate (0–1)">
          {(field) => <Input {...field} value={rate} onChange={(e) => setRate(e.target.value)} />}
        </Field>
      ) : null}
      {sampling === 'filtered' ? (
        <Field label="Filtering limitations" className="sm:col-span-2">
          {(field) => (
            <Input {...field} value={filter} onChange={(e) => setFilter(e.target.value)} />
          )}
        </Field>
      ) : null}
    </>
  );
}
/** The stream's declared buffer interval and whether it runs the filter Lambda. */
function FirehoseFields({ model }: Readonly<{ model: ReturnType<typeof useCrawlConnections> }>) {
  const { bufferInterval, setBufferInterval, declaredFiltered, setDeclaredFiltered } = model;
  return (
    <>
      <Field
        label="Firehose buffer interval (seconds)"
        hint={`Use the value set on the stream; ${FIREHOSE_BUFFER_INTERVAL.min}–${FIREHOSE_BUFFER_INTERVAL.recommendedMax} is recommended.`}
      >
        {(field) => (
          <Input
            {...field}
            inputMode="numeric"
            value={bufferInterval}
            onChange={(e) => setBufferInterval(e.target.value)}
          />
        )}
      </Field>
      <Checkbox
        className="sm:col-span-2"
        checked={declaredFiltered}
        onCheckedChange={(checked) => setDeclaredFiltered(checked === true)}
        label="The stream runs the CiteLadder filter Lambda (coverage stays partial)"
      />
    </>
  );
}
/** Generated AWS console steps; the endpoint and token appear once the source exists. */
function FirehoseSteps({ interval }: Readonly<{ interval: string }>) {
  return (
    <ol className="type-body text-secondary grid list-decimal gap-1 pl-5">
      <li>
        In us-east-1, create an Amazon Data Firehose stream: source Direct PUT, destination HTTP
        endpoint. Use the endpoint URL and the token (as the access key) shown after you create the
        source. Content encoding GZIP, buffer size 1–3 MiB, buffer interval {interval || '60'}{' '}
        seconds, retry duration 3600 seconds, S3 backup for failed data only.
      </li>
      <li>
        On the CloudFront distribution, add standard logging to Amazon Data Firehose, choose the
        stream and output format JSON, with these fields: {CLOUDFRONT_LOG_FIELDS.join(', ')}.
      </li>
      <li>
        Optional: to send crawler requests only, add the{' '}
        <TextLink variant="external" href={FIREHOSE_FILTER_TEMPLATE}>
          CiteLadder filter Lambda
        </TextLink>{' '}
        as the stream&apos;s data transformation and tick the box below. Coverage then stays
        partial.
      </li>
      <li>
        CloudFront can take about four hours to start delivering reliably. The Firehose
        console&apos;s test data is not CloudFront logs and shows as an unsupported-format batch;
        test with a real page visit instead.
      </li>
    </ol>
  );
}
export function CrawlLogCredential({
  model,
}: Readonly<{ model: ReturnType<typeof useCrawlConnections> }>) {
  const { issued, sources } = model;
  const route = issued?.setup === 'aws_firehose' ? 'firehose' : 'ingest';
  const endpoint = `${CRAWL_INGEST_ORIGIN}/v1/crawl-logs/${route}/${issued?.id ?? ''}`;
  const pullSource =
    issued?.setup === 'gcp_pubsub_pull'
      ? sources.data?.items.find((source) => source.id === issued.id)
      : undefined;
  if (pullSource && sources.data)
    return (
      <GcpSourceSetup
        source={pullSource}
        gcp={sources.data.gcp_pull}
        projectId={model.projectId}
        workspaceId={model.workspaceId}
      />
    );
  return issued ? (
    <Alert tone="info">
      <div className="grid gap-3">
        {issued.token ? (
          <>
            <p>Copy this token now. It is shown once.</p>
            <CopyButton value={issued.token}>Copy token</CopyButton>
            <p className="type-caption break-all">{endpoint}</p>
            <CopyButton value={endpoint}>Copy endpoint</CopyButton>
          </>
        ) : null}
      </div>
    </Alert>
  ) : null;
}
/** The dialog's one committing action, held in its footer. */
export function CrawlLogSetupSubmit({
  model,
}: Readonly<{ model: ReturnType<typeof useCrawlConnections> }>) {
  const { canManage, sources, mutation, issued } = model;
  return (
    <Button
      disabled={!canManage || sources.data?.availability !== 'available' || issued !== null}
      pending={mutation.isPending}
      onClick={() => mutation.mutate({ kind: 'create' })}
    >
      Create source
    </Button>
  );
}

function UploadForm({ model }: Readonly<{ model: ReturnType<typeof useCrawlConnections> }>) {
  const formId = useId();
  const {
    sources,
    sourceId,
    setSourceId,
    file,
    setFile,
    resume,
    setResume,
    upload,
    progress,
    processing,
  } = model;
  const uploadSources = (sources.data?.items ?? []).filter(
    (s) => s.kind === 'upload' && s.status === 'active',
  );
  if (!uploadSources.length) {
    return (
      <Alert tone="info">
        First, create an upload source using the settings above and Create source below. Then choose
        your log file here to upload recognized requests.
      </Alert>
    );
  }
  return (
    <div className="grid gap-4">
      <Field label="Upload source">
        {({ id }) => (
          <Select
            id={id}
            ariaLabel="Upload source"
            value={sourceId}
            onValueChange={setSourceId}
            options={uploadSources.map((s) => ({
              value: s.id,
              label: s.host + ' · ' + logFormatLabel(s.format),
            }))}
          />
        )}
      </Field>
      <label htmlFor={`${formId}-file`} className="type-label grid gap-2">
        Log file
        <Input
          id={`${formId}-file`}
          type="file"
          accept=".log,.txt,.json,.ndjson,.gz"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <label htmlFor={`${formId}-resume`} className="type-label grid gap-2">
        Resume upload ID (optional)
        <Input id={`${formId}-resume`} value={resume} onChange={(e) => setResume(e.target.value)} />
      </label>
      <Button
        variant="secondary"
        className="w-fit"
        disabled={!file || !sourceId || sources.data?.availability !== 'available'}
        pending={upload.isPending}
        onClick={() => upload.mutate(resume || undefined)}
      >
        Upload recognized requests
      </Button>
      {progress ? (
        <output className="type-body">
          {progress.scanned} lines scanned · {progress.matched} recognized crawler requests sent.
        </output>
      ) : null}
      {upload.isSuccess ? (
        <Alert tone={processing ? 'info' : 'success'}>
          {processing
            ? 'Upload complete. Results appear here once processing finishes, usually within a few minutes.'
            : 'Upload processed. Coverage for these days is declared by the file.'}
        </Alert>
      ) : null}
      {upload.isError ? (
        <Alert tone="danger">
          <div className="grid gap-2">
            <p>{upload.error.message}</p>
            {progress ? (
              <Button
                variant="secondary"
                className="w-fit"
                onClick={() => upload.mutate(progress.uploadId)}
              >
                Resume upload
              </Button>
            ) : null}
          </div>
        </Alert>
      ) : null}
    </div>
  );
}
