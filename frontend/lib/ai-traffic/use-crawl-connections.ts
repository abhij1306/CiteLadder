import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  aiTrafficApi,
  aiTrafficMutations,
  aiTrafficQueries,
  refreshAiTraffic,
  refreshCrawlSources,
} from '@/lib/api/ai-traffic';
import {
  CRAWL_LOG_SETUPS,
  FIREHOSE_BUFFER_INTERVAL,
  UPLOAD_PROCESSING_MAX_WAIT_MS,
  UPLOAD_PROCESSING_POLL_MS,
} from '@/lib/config/crawl-logs';
import { uploadCrawlFile } from './upload';
import type { z } from 'zod';
import type { crawlSourceListSchema } from '@citeladder/contracts/ai-traffic';
import type { CrawlSourceCreateRequest } from '@citeladder/contracts/crawl-log-requests';

/** The log format and collection point a custom sender declares. */
type LogFormat = NonNullable<CrawlSourceCreateRequest['format']>;
type CollectionPoint = NonNullable<CrawlSourceCreateRequest['collection_point']>;
export type CrawlConnectionInput = Readonly<{
  projectId: string;
  workspaceId: string;
  website: string;
  canManage: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}>;
/** The project's crawl log sources; shared by the screen and the connections section. */
export function useCrawlSources(
  projectId: string,
  workspaceId: string,
  awaiting: Awaiting | null = null,
) {
  return useQuery({
    ...aiTrafficQueries.sources({ workspaceId, projectId }),
    enabled: !!projectId && !!workspaceId,
    refetchInterval: (query) =>
      awaiting && uploadProcessing(query.state.data, awaiting) === 'processing'
        ? UPLOAD_PROCESSING_POLL_MS
        : false,
  });
}
/**
 * A completed upload is processed after a short delay, then its source reports
 * it. `completedAt` is the server's completion time, so both sides of the
 * comparison come from the server clock; `timedOut` ends the bounded wait.
 */
type Awaiting = Readonly<{ sourceId: string; completedAt: string; timedOut: boolean }>;
export type UploadProcessing = 'processing' | 'processed' | 'delayed';
export function uploadProcessing(
  data: z.infer<typeof crawlSourceListSchema> | undefined,
  awaiting: Awaiting,
): UploadProcessing {
  const at = data?.items.find((s) => s.id === awaiting.sourceId)?.last_processed_at;
  if (at && Date.parse(at) >= Date.parse(awaiting.completedAt)) return 'processed';
  return awaiting.timedOut ? 'delayed' : 'processing';
}
/** Crawl views stay for a project that already has sources, even if collection is unavailable. */
export function crawlLogsAvailable(data: z.infer<typeof crawlSourceListSchema>) {
  return data.availability === 'available' || data.items.length > 0;
}
/** The sampling a custom sender declares, from the dialog's fields. */
function declaredSampling(sampling: string, rate: string, filter: string) {
  if (sampling === 'sampled') return { kind: 'sampled', rate: Number(rate) } as const;
  if (sampling === 'filtered') return { kind: 'filtered', description: filter } as const;
  return { kind: 'none' } as const;
}
/**
 * What a setup declares: Firehose its buffer and filter, Google Cloud its
 * subscription and sample rate, the others format, point and sampling.
 */
function declaredFields(
  setup: (typeof CRAWL_LOG_SETUPS)[number]['value'],
  fields: Readonly<{
    format: LogFormat;
    point: CollectionPoint;
    sampling: string;
    rate: string;
    filter: string;
    bufferInterval: string;
    declaredFiltered: boolean;
    subscription: string;
    sampleRate: string;
  }>,
) {
  if (setup === 'aws_firehose')
    return {
      buffer_interval_seconds: Number(fields.bufferInterval),
      declared_filtered: fields.declaredFiltered,
    };
  if (setup === 'gcp_pubsub_pull')
    return {
      subscription: fields.subscription.trim(),
      declared_sample_rate: Number(fields.sampleRate),
    };
  return {
    format: fields.format,
    collection_point: fields.point,
    sampling: declaredSampling(fields.sampling, fields.rate, fields.filter),
  };
}
export function useCrawlConnections({
  projectId,
  workspaceId,
  website,
  canManage,
  open: controlledOpen,
  onOpenChange,
}: CrawlConnectionInput) {
  const client = useQueryClient(),
    options = { workspaceId },
    scope = { workspaceId, projectId };
  const [awaiting, setAwaiting] = useState<Awaiting | null>(null);
  const sources = useCrawlSources(projectId, workspaceId, awaiting);
  const processing = awaiting ? uploadProcessing(sources.data, awaiting) : null;
  // Processing finished: refresh the reads that show the new rows.
  useEffect(() => {
    if (processing === 'processed') void refreshAiTraffic(client, projectId);
  }, [processing, client, projectId]);
  // The wait is bounded: a failed or slow rollup stops the rechecks. Each
  // upload's completion starts its own wait.
  const waitingFor = awaiting && !awaiting.timedOut ? awaiting.completedAt : null;
  useEffect(() => {
    if (!waitingFor) return;
    const timer = setTimeout(
      () => setAwaiting((current) => current && { ...current, timedOut: true }),
      UPLOAD_PROCESSING_MAX_WAIT_MS,
    );
    return () => clearTimeout(timer);
  }, [waitingFor]);
  const [localOpen, setLocalOpen] = useState(false),
    [setup, setSetup] = useState<(typeof CRAWL_LOG_SETUPS)[number]['value']>('cloudflare_worker');
  const open = controlledOpen ?? localOpen;
  const setOpen = (value: boolean) => {
    setLocalOpen(value);
    onOpenChange?.(value);
  };
  const [origin, setOrigin] = useState(() => {
    try {
      return new URL(website).origin;
    } catch {
      return '';
    }
  });
  const [format, setFormat] = useState<LogFormat>('ndjson'),
    [sampling, setSampling] = useState('filtered'),
    [rate, setRate] = useState('1'),
    [filter, setFilter] = useState('Best-effort recognized automated requests');
  const [point, setPoint] = useState<CollectionPoint>('cdn_edge');
  const [bufferInterval, setBufferInterval] = useState(String(FIREHOSE_BUFFER_INTERVAL.default)),
    [declaredFiltered, setDeclaredFiltered] = useState(false);
  const [subscription, setSubscription] = useState(''),
    [sampleRate, setSampleRate] = useState('1');
  const [issued, setIssued] = useState<{
    id: string;
    token: string | null;
    setup?: (typeof CRAWL_LOG_SETUPS)[number]['value'];
  } | null>(null);
  const [sourceId, setSourceId] = useState(''),
    [resume, setResume] = useState(''),
    [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<{
    uploadId: string;
    scanned: number;
    matched: number;
  } | null>(null);
  const mutation = useMutation(aiTrafficMutations.source(scope));
  /**
   * Issue a source from the dialog's fields, or revoke one. The descriptor
   * refreshes the project's reads; the issued token is shown here. Rotation
   * owns its own dialog and mutation (`RotateTokenDialog`).
   */
  const issueSource = (
    action: { kind: 'create' } | { kind: 'revoke'; id: string },
    onSettled?: () => void,
  ) =>
    mutation.mutate(
      action.kind === 'create'
        ? {
            kind: 'create',
            input: {
              setup,
              origin,
              ...declaredFields(setup, {
                format,
                point,
                sampling,
                rate,
                filter,
                bufferInterval,
                declaredFiltered,
                subscription,
                sampleRate,
              }),
            },
          }
        : action,
      {
        onSuccess: (result) => {
          if (action.kind === 'revoke') {
            if (sourceId === action.id) setSourceId('');
            return;
          }
          setIssued({ ...result, setup });
          if (setup === 'upload') setSourceId(result.id);
        },
        onSettled,
      },
    );
  const upload = useMutation({
    mutationFn: async (resumeId?: string) => {
      setProgress(null);
      const source = sources.data?.items.find((s) => s.id === sourceId);
      if (!file || !source) throw new Error('Choose a source and a file');
      const catalog = await aiTrafficApi.catalog(projectId, options);
      const mapping = catalog.presets.custom_ndjson;
      if (!mapping) throw new Error('The upload mapping is unavailable');
      const result = await uploadCrawlFile({
        file,
        // The file is read in the format its source was created with.
        format: source.format,
        mapping,
        catalog,
        projectId,
        sourceId,
        resumeId,
        options,
        onProgress: setProgress,
      });
      setAwaiting({ sourceId, completedAt: result.completedAt, timedOut: false });
      // The rows appear after processing; the effect above refreshes every read then.
      await refreshCrawlSources(client, projectId);
      return result;
    },
  });

  return {
    canManage,
    projectId,
    workspaceId,
    sources,
    open,
    setOpen,
    setup,
    setSetup,
    origin,
    setOrigin,
    format,
    setFormat,
    sampling,
    setSampling,
    rate,
    setRate,
    filter,
    setFilter,
    point,
    setPoint,
    bufferInterval,
    setBufferInterval,
    declaredFiltered,
    setDeclaredFiltered,
    subscription,
    setSubscription,
    sampleRate,
    setSampleRate,
    issued,
    setIssued,
    sourceId,
    setSourceId,
    resume,
    setResume,
    file,
    setFile,
    progress,
    processing,
    mutation,
    issueSource,
    upload,
  };
}
