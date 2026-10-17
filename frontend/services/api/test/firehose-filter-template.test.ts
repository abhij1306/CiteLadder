import { describe, expect, it } from 'vitest';
import { handler, CATALOG_VERSION } from '../../../public/templates/citeladder-firehose-filter.mjs';
import { crawlers } from '../src/config/crawlers.ts';
import { firehoseFilterSource } from '../scripts/firehose-filter-source.ts';

const line = (userAgent: string, path = '/') =>
  JSON.stringify({ 'cs-uri-stem': path, 'cs(User-Agent)': userAgent });
const encode = (...lines: string[]) => Buffer.from(lines.join('\n') + '\n').toString('base64');
const decode = (data: string) => Buffer.from(data, 'base64').toString('utf8');

describe('Firehose filter Lambda template', () => {
  it('keeps recognized crawler lines and drops records with none', async () => {
    const gptbot = line('Mozilla/5.0%20(compatible;%20GPTBot/1.2)', '/kept');
    const browser = line('Mozilla/5.0%20(Windows%20NT%2010.0)', '/browser');
    const result = await handler({
      records: [
        { recordId: 'mixed', data: encode(browser, gptbot) },
        { recordId: 'people', data: encode(browser) },
        { recordId: 'garbled', data: encode('not json') },
      ],
    });
    expect(result.records.map((r) => [r.recordId, r.result])).toEqual([
      ['mixed', 'Ok'],
      ['people', 'Dropped'],
      ['garbled', 'Dropped'],
    ]);
    expect(decode(result.records[0]!.data)).toBe(gptbot + '\n');
  });
  it('is generated from the current catalog version', () => {
    expect(CATALOG_VERSION).toBe(crawlers.catalog_version);
    const next = firehoseFilterSource({ ...crawlers, catalog_version: 'next-version' });
    expect(next).toContain('export const CATALOG_VERSION = "next-version";');
    expect(next).not.toBe(firehoseFilterSource(crawlers));
  });
});
