import { describe, expect, it } from 'vitest';
import config from '../src/config/crawl-logs.json' with { type: 'json' };
import { loadCrawlLogs } from '../src/config/crawl-logs.ts';

describe('crawl log admission policy', () => {
  it('rejects admission of backfills that can reach frozen rollups', () => {
    expect(() => loadCrawlLogs({ ...config, max_backdate_days: 83 })).toThrow(/unfrozen/);
    expect(() => loadCrawlLogs({ ...config, max_backdate_days: 82 })).not.toThrow();
  });
  it('rejects inconsistent payload and verification bounds', () => {
    expect(() =>
      loadCrawlLogs({ ...config, max_line_bytes: config.max_batch_bytes + 1 }),
    ).toThrow();
    expect(() => loadCrawlLogs({ ...config, ip_range_contemporaneous_hours: 100 })).toThrow();
  });
});
