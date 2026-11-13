import { describe, expect, it, vi } from 'vitest';

import { extractPageFacts, factSettings } from '../src/site-health/analysis/facts.ts';
import { extractFactsAsync } from '../src/site-health/analysis/off-thread.ts';

const facts = (html: string, url: string) =>
  extractPageFacts(Buffer.from(html), { finalUrl: url, contentType: 'text/html', statusCode: 200 });

describe('URLs a page declares resolve against its document base', () => {
  it('reads a relative canonical as the URL the base makes it', () => {
    const page = facts(
      '<html><head><base href="https://cdn.other.test/docs/"><link rel="canonical" href="post"></head><main><p>Text</p></main></html>',
      'https://example.test/blog/post',
    );
    expect(page.canonical_declarations).toEqual(['https://cdn.other.test/docs/post']);
    expect(page.canonical_url).toBe('https://cdn.other.test/docs/post');
    // An empty declaration names nothing, rather than the base itself.
    const empty = facts(
      '<link rel="canonical" href=" "><main><p>Text</p></main>',
      'https://e.test/a',
    );
    expect(empty.canonical_declarations).toEqual([]);
  });

  it('reads a relative microdata URL as the absolute URL the microdata model defines', () => {
    const page = facts(
      `<html><head><base href="https://acme.test/shop/"></head><body><main>
      <div itemscope itemtype="https://schema.org/Product">
        <span itemprop="name">Trail Shoe</span><link itemprop="url" href="trail-shoe">
      </div></main></body></html>`,
      'https://acme.test/products/trail-shoe',
    );
    const blocks = page.structured_data.blocks as { type: string; url: string }[];
    expect(blocks.map((block) => [block.type, block.url])).toEqual([
      ['Product', 'https://acme.test/shop/trail-shoe'],
    ]);
  });
});

describe('the interpretation thread pool', () => {
  it('moves the jobs queued behind an overrunning job to another thread', async () => {
    const delivery = { finalUrl: 'https://example.test/page', contentType: 'text/html' };
    const large = Buffer.from(`<main>${'<p>Long workshop notes.</p>'.repeat(50_000)}</main>`);
    const small = Buffer.from('<html><head><title>Queued</title></head><main><p>ok</p></main>');
    vi.stubEnv('SITE_HEALTH_INTERPRETATION_JOB_TIMEOUT_SECONDS', '0.001');
    const overrun = extractFactsAsync(large, delivery, factSettings({}));
    const queued = extractFactsAsync(small, delivery, factSettings({}));
    vi.unstubAllEnvs();
    await expect(overrun).rejects.toThrow('Page interpretation exceeded its time limit');
    expect((await queued).title).toBe('Queued');
  });
});
