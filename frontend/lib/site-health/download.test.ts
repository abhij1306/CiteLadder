import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { exportFilename } from './download';
import { saveBlob } from '@/lib/download';

describe('exportFilename', () => {
  it('builds a per-view CSV filename from a short crawl id', () => {
    expect(exportFilename('abcdef01-2222-4222-8222-222222222222', 'csv', 'pages')).toBe(
      'site-health-pages-abcdef01.csv',
    );
  });

  it('builds a markdown filename (view-agnostic)', () => {
    expect(exportFilename('abcdef01-2222-4222-8222-222222222222', 'md', 'inventory')).toBe(
      'site-health-abcdef01.md',
    );
  });
});

describe('saveBlob', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates and revokes an object URL (no leak) and clicks a download anchor', () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    saveBlob(new Blob(['x']), 'file.csv');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // The object URL is always revoked so it does not leak.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    vi.unstubAllGlobals();
  });
});
