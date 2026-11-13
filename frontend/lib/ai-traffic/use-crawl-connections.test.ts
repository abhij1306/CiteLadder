import { describe, expect, it } from 'vite-plus/test';
import { uploadProcessing } from './use-crawl-connections';

const sources = (lastProcessedAt: string | null) => ({
  availability: 'available' as const,
  gcp_pull: {
    availability: 'available' as const,
    reader_email: null,
    log_filter: '',
    catalog_version: '1',
  },
  items: [
    {
      id: '99999999-9999-4999-8999-999999999999',
      kind: 'upload' as const,
      setup: 'upload' as const,
      preset: 'custom_ndjson',
      buffer_interval_seconds: null,
      format: 'ndjson',
      collection_point: 'application',
      sampling: { kind: 'none' as const },
      origin: 'https://example.test',
      host: 'example.test',
      status: 'active' as const,
      state: 'active' as const,
      stall_reason: null,
      stalled_at: null,
      pull: null,
      token_prefix: null,
      connection: 'connected' as const,
      last_accepted_batch: null,
      last_processed_at: lastProcessedAt,
      rejected_lines: 0,
      overlapping_lines: 0,
      unsupported_uploads: 0,
      unsupported_batches: 0,
    },
  ],
});
const awaiting = {
  sourceId: '99999999-9999-4999-8999-999999999999',
  completedAt: '2026-10-04T12:00:00.000Z',
  timedOut: false,
};

describe('upload processing wait', () => {
  it('compares the server completion time with the server processing time, not the browser clock', () => {
    // An earlier rollup does not count; one at or after the completion does,
    // whatever the device clock says.
    expect(uploadProcessing(sources('2026-10-04T11:59:59.000Z'), awaiting)).toBe('processing');
    expect(uploadProcessing(sources(null), awaiting)).toBe('processing');
    expect(uploadProcessing(sources('2026-10-04T12:00:00Z'), awaiting)).toBe('processed');
    expect(uploadProcessing(sources('2026-10-04T12:00:30.000Z'), awaiting)).toBe('processed');
  });
  it('reports a delay once the bounded wait ends without processing', () => {
    const timedOut = { ...awaiting, timedOut: true };
    expect(uploadProcessing(sources('2026-10-04T11:00:00.000Z'), timedOut)).toBe('delayed');
    expect(uploadProcessing(sources('2026-10-04T12:01:00.000Z'), timedOut)).toBe('processed');
  });
});
