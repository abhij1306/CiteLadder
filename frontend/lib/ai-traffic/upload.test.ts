import { describe, expect, it, vi, beforeEach } from 'vite-plus/test';
import { ReadableStream, TextDecoderStream, DecompressionStream } from 'node:stream/web';
import { gzipSync } from 'node:zlib';
import { uploadCrawlFile } from './upload';
import { aiTrafficApi } from '@/lib/api/ai-traffic';
vi.mock('@/lib/api/ai-traffic', () => ({
  aiTrafficApi: {
    createUpload: vi.fn(),
    uploadStatus: vi.fn(),
    uploadBatch: vi.fn(),
    completeUpload: vi.fn(),
  },
}));
const mapping = {
  timestamp: 'timestamp',
  host: 'host',
  path: 'path',
  method: 'method',
  status: 'status',
  user_agent: 'user_agent',
  client_ip: 'client_ip',
  request_id: 'request_id',
  timestamp_unit: 'iso' as const,
};
const catalog = {
  catalog_version: '1',
  bots: [
    {
      bot_id: 'test',
      label: 'Test bot',
      purpose: 'ai_search' as const,
      ua_patterns: ['known-robot'],
    },
  ],
  presets: {
    custom_ndjson: {
      ...mapping,
      collection_point: 'application',
      sampling: { kind: 'none' as const },
    },
  },
  max_batch_bytes: 2000,
  max_lines_per_batch: 1,
  upload_sample_lines: 50,
  max_line_bytes: 1000,
  max_backdate_days: 80,
  worker_timeout_ms: 5000,
};
const event = (ua: string, path = '/page') => ({
  timestamp: '2026-10-02T12:00:00Z',
  path,
  method: 'GET',
  status: 200,
  user_agent: ua,
});
function file(data: string | Uint8Array, name = 'logs.ndjson') {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return {
    name,
    size: bytes.length,
    stream: () =>
      new ReadableStream({
        start(controller) {
          // Chunk boundaries split records and UTF-8 decoding.
          for (let i = 0; i < bytes.length; i += 13) controller.enqueue(bytes.slice(i, i + 13));
          controller.close();
        },
      }),
  } as unknown as File;
}
const run = (value: File, format = 'ndjson', resumeId?: string) =>
  uploadCrawlFile({
    file: value,
    format,
    mapping,
    catalog,
    projectId: 'project',
    sourceId: 'source',
    resumeId,
    options: { workspaceId: 'workspace' },
    onProgress: vi.fn(),
  });
beforeEach(() => {
  vi.clearAllMocks();
  // Fixture timestamps sit inside the admission window relative to this clock.
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-04T00:00:00Z'));
  vi.stubGlobal('TextDecoderStream', TextDecoderStream);
  vi.stubGlobal('DecompressionStream', DecompressionStream);
  vi.mocked(aiTrafficApi.createUpload).mockResolvedValue({
    id: 'upload',
    filename: 'logs.ndjson',
    size_bytes: 0,
    status: 'open',
    last_ack_seq: -1,
    scanned_lines: 0,
    missing_fields: [],
    created_at: '2026-10-04T00:00:00Z',
  });
  vi.mocked(aiTrafficApi.uploadBatch).mockResolvedValue({
    id: 'batch',
    lines_received: 1,
    lines_parsed: 1,
    lines_matched: 1,
    lines_unmatched: 0,
    lines_out_of_scope: 0,
    lines_rejected: 0,
    lines_duplicate: 0,
    lines_overlapping: 0,
    heartbeat: false,
  });
});
describe('local streaming upload privacy', () => {
  it('reports every scanned day and leaves completeness to the server', async () => {
    const rows = ['2026-10-01', '2026-10-02', '2026-10-03'].map((day) => ({
      ...event('unmatched'),
      timestamp: day + 'T12:00:00Z',
    }));
    await run(file(rows.map((row) => JSON.stringify(row)).join('\n')));
    expect(aiTrafficApi.completeUpload).toHaveBeenCalledWith(
      'project',
      'source',
      'upload',
      expect.objectContaining({
        scanned_dates: ['2026-10-01', '2026-10-02', '2026-10-03'],
      }),
      expect.anything(),
    );
  });
  it('sends only recognized lines and completes zero-match scans without sending batches', async () => {
    await run(
      file(
        JSON.stringify(event('unmatched-private-agent')) +
          '\n' +
          JSON.stringify(event('known-robot')),
      ),
    );
    const posted = vi.mocked(aiTrafficApi.uploadBatch).mock.calls[0]![4];
    expect(posted).toHaveLength(1);
    expect(JSON.stringify(posted)).not.toContain('unmatched-private-agent');
    expect(aiTrafficApi.completeUpload).toHaveBeenCalledWith(
      'project',
      'source',
      'upload',
      expect.objectContaining({ scanned_lines: 2 }),
      expect.anything(),
    );
    vi.mocked(aiTrafficApi.uploadBatch).mockClear();
    await run(file(JSON.stringify(event('unmatched-only'))));
    expect(aiTrafficApi.uploadBatch).not.toHaveBeenCalled();
    expect(aiTrafficApi.completeUpload).toHaveBeenLastCalledWith(
      'project',
      'source',
      'upload',
      expect.objectContaining({
        scanned_lines: 1,
        scanned_dates: ['2026-10-02'],
      }),
      expect.anything(),
    );
  });
  it('resumes deterministic batches on a later day and streams gzip JSON arrays', async () => {
    // Resumed long after creation: the upload's own floor still admits these lines.
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-12-28T00:00:00Z'));
    const rows = [event('known-robot', '/one'), event('known-robot', '/two')];
    const original = file(gzipSync(Buffer.from(JSON.stringify(rows))), 'logs.json.gz');
    vi.mocked(aiTrafficApi.uploadStatus).mockResolvedValue({
      id: 'upload',
      filename: original.name,
      size_bytes: original.size,
      status: 'open',
      last_ack_seq: 0,
      scanned_lines: 0,
      missing_fields: [],
      created_at: '2026-10-04T00:00:00Z',
    });
    await run(original, 'json_array', 'upload');
    expect(aiTrafficApi.createUpload).not.toHaveBeenCalled();
    expect(aiTrafficApi.uploadBatch).toHaveBeenCalledTimes(1);
    expect(aiTrafficApi.uploadBatch).toHaveBeenCalledWith(
      'project',
      'source',
      'upload',
      1,
      [expect.stringContaining('/two')],
      expect.anything(),
    );
  });
  it('names the created upload before its first batch, so a failed first batch can resume', async () => {
    vi.mocked(aiTrafficApi.uploadBatch).mockRejectedValueOnce(new Error('network'));
    const onProgress = vi.fn();
    await expect(
      uploadCrawlFile({
        file: file(JSON.stringify(event('known-robot'))),
        format: 'ndjson',
        mapping,
        catalog,
        projectId: 'project',
        sourceId: 'source',
        options: { workspaceId: 'workspace' },
        onProgress,
      }),
    ).rejects.toThrow('network');
    expect(onProgress).toHaveBeenCalledWith({ uploadId: 'upload', scanned: 0, matched: 0 });
  });
  it('skips lines older than the admission window and refuses files with none inside it', async () => {
    const old = { ...event('known-robot', '/old'), timestamp: '2026-01-01T12:00:00Z' };
    await run(file([old, event('known-robot')].map((row) => JSON.stringify(row)).join('\n')));
    expect(aiTrafficApi.uploadBatch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(aiTrafficApi.uploadBatch).mock.calls[0]![4].join()).not.toContain('/old');
    expect(vi.mocked(aiTrafficApi.completeUpload).mock.calls[0]![3]).toMatchObject({
      scanned_lines: 2,
      first_line_at: '2026-10-02T12:00:00.000Z',
    });
    vi.clearAllMocks();
    await expect(run(file(JSON.stringify(old)))).rejects.toThrow(/last 80 days/);
    expect(aiTrafficApi.uploadBatch).not.toHaveBeenCalled();
    expect(aiTrafficApi.completeUpload).not.toHaveBeenCalled();
  });
  it('skips a line without identifying fields and refuses files where none has them', async () => {
    await run(file(JSON.stringify(event('known-robot')) + '\n{"path":"/missing"}'));
    expect(vi.mocked(aiTrafficApi.uploadBatch).mock.calls[0]![4]).toEqual([
      expect.stringContaining('known-robot'),
    ]);
    vi.clearAllMocks();
    await expect(run(file('{"path":"/no-user-agent"}'))).rejects.toThrow(/crawler identification/);
    await expect(
      run(file('[' + JSON.stringify(event('known-robot')) + ',]'), 'json_array'),
    ).rejects.toThrow(/comma/);
    await expect(run(file(new Uint8Array([255])))).rejects.toThrow();
    expect(aiTrafficApi.createUpload).not.toHaveBeenCalled();
    expect(aiTrafficApi.uploadBatch).not.toHaveBeenCalled();
  });
});
