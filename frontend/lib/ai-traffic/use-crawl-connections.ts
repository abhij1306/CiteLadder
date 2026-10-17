import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { aiTrafficApi } from '@/lib/api/ai-traffic';
import { queryKeys } from '@/lib/api/query-keys';
import {
  CRAWL_LOG_SETUPS,
  FIREHOSE_BUFFER_INTERVAL,
  UPLOAD_PROCESSING_POLL_MS,
} from '@/lib/config/crawl-logs';
import { uploadCrawlFile } from './upload';
import type { z } from 'zod';
import type { crawlSourceListSchema } from '@citeladder/contracts/ai-traffic';
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
    queryKey: queryKeys.aiTraffic.view(workspaceId, projectId, 'sources'),
    queryFn: ({ signal }) => aiTrafficApi.sources(projectId, { workspaceId, signal }),
    enabled: !!projectId && !!workspaceId,
    refetchInterval: (query) =>
      awaiting && !uploadProcessed(query.state.data, awaiting) ? UPLOAD_PROCESSING_POLL_MS : false,
  });
}
/** A completed upload is processed after a short delay, then its source reports it. */
type Awaiting = { sourceId: string; since: string };
function uploadProcessed(
  data: z.infer<typeof crawlSourceListSchema> | undefined,
  awaiting: Awaiting,
) {
  const at = data?.items.find((s) => s.id === awaiting.sourceId)?.last_processed_at;
  return !!at && at >= awaiting.since;
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
    format: string;
    point: string;
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
    options = { workspaceId };
  const [awaiting, setAwaiting] = useState<Awaiting | null>(null);
  const sources = useCrawlSources(projectId, workspaceId, awaiting);
  const processing = awaiting !== null && !uploadProcessed(sources.data, awaiting);
  // Processing finished: refresh the reads that show the new rows.
  useEffect(() => {
    if (awaiting && !processing)
      void client.invalidateQueries({ queryKey: queryKeys.aiTraffic.all });
  }, [awaiting, processing, client]);
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
  const [format, setFormat] = useState('ndjson'),
    [sampling, setSampling] = useState('filtered'),
    [rate, setRate] = useState('1'),
    [filter, setFilter] = useState('Best-effort recognized automated requests');
  const [point, setPoint] = useState('cdn_edge');
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
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.aiTraffic.all });
  const mutation = useMutation({
    mutationFn: async (action: { kind: 'create' } | { kind: 'rotate' | 'revoke'; id: string }) => {
      if (action.kind !== 'create')
        return aiTrafficApi.mutateSource(projectId, action.id, action.kind, options);
      return aiTrafficApi.createSource(
        projectId,
        {
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
        options,
      );
    },
    onSuccess: async (result, action) => {
      const issuedSetup =
        action.kind === 'create'
          ? setup
          : sources.data?.items.find((source) => source.id === action.id)?.setup;
      setIssued({ ...result, setup: issuedSetup });
      if (action.kind === 'create' && setup === 'upload') setSourceId(result.id);
      if (action.kind === 'revoke' && sourceId === action.id) setSourceId('');
      await refresh();
    },
  });
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
      setAwaiting({ sourceId, since: new Date().toISOString() });
      // The rows appear after processing; the effect above refreshes every read then.
      await client.invalidateQueries({
        queryKey: queryKeys.aiTraffic.view(workspaceId, projectId, 'sources'),
      });
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
    upload,
  };
}
