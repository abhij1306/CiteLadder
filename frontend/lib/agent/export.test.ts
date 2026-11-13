import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

const mocks = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/download', () => ({ saveBlob: mocks.saveBlob }));

import { downloadPage, pageExport } from './export';

const BODY = [
  '# Pricing',
  '',
  'Plans start at **ten** dollars. [Compare](https://example.com/compare).',
  '',
  '- Starter',
  '  - Monthly',
  '- Teams',
  '',
  '| Plan | Price |',
  '| --- | --- |',
  '| Starter | $10 |',
  '',
  '<script>alert(1)</script>',
  '',
].join('\n');

afterEach(() => mocks.saveBlob.mockReset());

describe('pageExport', () => {
  it('copies the Markdown as written, with one final newline', () => {
    expect(pageExport('# Pricing\n\nPlans.\n\n\n', 'markdown')).toBe('# Pricing\n\nPlans.\n');
  });

  it('renders HTML through the app’s Markdown pipeline, raw HTML left out', () => {
    const html = pageExport(BODY, 'html');
    expect(html).toContain('<h1>Pricing</h1>');
    expect(html).toContain(
      '<p>Plans start at <strong>ten</strong> dollars. <a href="https://example.com/compare">Compare</a>.</p>',
    );
    expect(html).toContain('<td>Starter</td>');
    expect(html).not.toContain('<script>');
  });

  it('writes plain text without Markdown marks, keeping lists and tables readable', () => {
    expect(pageExport(BODY, 'text')).toBe(
      [
        'Pricing',
        '',
        'Plans start at ten dollars. Compare.',
        '',
        '- Starter',
        '  - Monthly',
        '- Teams',
        '',
        'Plan\tPrice',
        'Starter\t$10',
        '',
      ].join('\n'),
    );
  });
});

describe('downloadPage', () => {
  it('downloads a standalone HTML file named and titled by the title tag', async () => {
    downloadPage('Pricing <Plans> & more', '# Pricing', 'html');
    const [blob, filename] = mocks.saveBlob.mock.calls[0] as [Blob, string];
    expect(filename).toBe('pricing-plans-more.html');
    const text = await blob.text();
    expect(text).toContain('<title>Pricing &lt;Plans&gt; &amp; more</title>');
    expect(text).toContain('<body>\n<h1>Pricing</h1>\n</body>');
  });

  it('downloads the Markdown as a .md file', async () => {
    downloadPage('Pricing', 'Plans.', 'md');
    const [blob, filename] = mocks.saveBlob.mock.calls[0] as [Blob, string];
    expect(filename).toBe('pricing.md');
    expect(await blob.text()).toBe('Plans.\n');
  });
});
