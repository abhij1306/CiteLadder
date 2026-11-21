export const CRAWL_LOG_SETUPS = [
  {
    value: 'cloudflare_worker',
    collectionPoint: 'cdn_edge',
    label: 'Cloudflare Worker',
    description: 'Best-effort per-request delivery. Coverage is at most partial.',
  },
  {
    value: 'cloudflare_logpush',
    collectionPoint: 'cdn_edge',
    label: 'Cloudflare Logpush',
    description:
      'Enterprise HTTP request logs. Unsampled, gap-free days can reach complete coverage.',
  },
  {
    value: 'aws_firehose',
    collectionPoint: 'cdn_edge',
    label: 'Amazon CloudFront',
    description:
      'Standard logs through Amazon Data Firehose. Unfiltered, gap-free days can reach complete coverage.',
  },
  {
    value: 'gcp_pubsub_pull',
    collectionPoint: 'cdn_edge',
    label: 'Google Cloud',
    description:
      'Load balancer and Cloud Run request logs through Pub/Sub, pulled by CiteLadder. Unsampled, drained days can reach complete coverage.',
  },
  {
    value: 'custom',
    collectionPoint: 'application',
    label: 'Custom webhook',
    description: 'Batch NDJSON or JSON from your shipper. Declare collection point and sampling.',
  },
  {
    value: 'upload',
    collectionPoint: 'uploaded_file',
    label: 'Upload file',
    description:
      'Local pre-filtering and resumable backfill. Full-day scans are labelled client-reported.',
  },
] as const;
export const FIREHOSE_BUFFER_INTERVAL = {
  default: 60,
  min: 60,
  recommendedMax: 300,
} as const;
/** The generated Firehose transformation Lambda, served with the app. */
export const FIREHOSE_FILTER_TEMPLATE = '/templates/citeladder-firehose-filter.mjs';
/** CloudFront standard logging (v2) fields the Firehose stream must deliver, in setup order. */
export const CLOUDFRONT_LOG_FIELDS = [
  'timestamp(ms)',
  'c-ip',
  'sc-status',
  'cs-method',
  'cs-uri-stem',
  'x-edge-request-id',
  'x-host-header',
  'cs(User-Agent)',
] as const;
export const GCP_PULL_SETUP = {
  topic: 'citeladder-ai-crawlers',
  sink: 'citeladder-ai-crawlers',
  ackDeadlineSeconds: 120,
  retention: '7d',
  sourceLabel: 'citeladder-source',
  subscriptionPlaceholder: 'projects/my-project/subscriptions/citeladder-ai-crawlers-sub',
} as const;
export { API_HOST_ORIGIN as CRAWL_INGEST_ORIGIN } from './api-host';
export const UPLOAD_PROCESSING_POLL_MS = 15000;
export const UPLOAD_PROCESSING_MAX_WAIT_MS = 10 * 60 * 1000;
export const TRAFFIC_RANGES = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '1y', label: 'Last 12 months' },
] as const;
export const TRAFFIC_PAGE_SORTS = [
  'requests_desc',
  'sessions_desc',
  'key_events_desc',
  'citations_desc',
  'url_asc',
] as const;
export type TrafficPagesSort = (typeof TRAFFIC_PAGE_SORTS)[number];
export const VERIFICATION_OPTIONS = [
  { value: 'default', label: 'Verified + unverifiable' },
  { value: 'verified', label: 'Verified' },
  { value: 'unverifiable', label: 'Unverifiable' },
  { value: 'failed_verification', label: 'Failed verification' },
] as const;
