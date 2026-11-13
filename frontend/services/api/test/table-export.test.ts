import { describe, expect, it } from 'vitest';

import { csvDownload } from '../src/http/table-export.ts';
import { setLogSink } from '../src/logging.ts';

describe('streamed CSV download', () => {
  it('writes the header and each batch as the client reads', async () => {
    async function* batches() {
      yield [{ url: 'https://a.example/', hits: 2 }];
      yield [{ url: '=cmd()', hits: null }];
    }
    const response = csvDownload('pages.csv', ['url', 'hits'], batches());

    expect(response.headers.get('content-disposition')).toBe('attachment; filename="pages.csv"');
    expect(await response.text()).toBe("url,hits\r\nhttps://a.example/,2\r\n'=cmd(),\r\n");
  });

  it('ends the download and logs the export when a later batch fails', async () => {
    async function* batches() {
      yield [{ url: 'https://a.example/' }];
      throw new Error('connection reset');
    }
    const records: Record<string, unknown>[] = [];
    const restore = setLogSink((line) => records.push(JSON.parse(line) as Record<string, unknown>));
    try {
      const response = csvDownload('pages.csv', ['url'], batches());
      await expect(response.text()).rejects.toThrow('connection reset');
    } finally {
      setLogSink(restore);
    }

    expect(records).toMatchObject([
      {
        event: 'table_export_failed',
        severity: 'ERROR',
        filename: 'pages.csv',
        exception: 'Error: connection reset',
      },
    ]);
  });
});
