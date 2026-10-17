import { describe, expect, it } from 'vite-plus/test';

import { normalizeEvidenceMarkdown } from './evidence-card';

describe('normalizeEvidenceMarkdown', () => {
  it('rejoins citation-split list sentences without flattening real Markdown blocks', () => {
    const response = [
      'Here is the landscape:',
      '**Catalog tools**',
      '- Bloomreach helped a retailer described as',
      "the UK's leading retailer with 27,000+ SKUs",
      ', restructure its catalog, delivering a',
      '+21% increase in AOV',
      '.',
      '- Width.ai focuses on product data.',
    ].join('\n\n');

    expect(normalizeEvidenceMarkdown(response)).toBe(
      [
        'Here is the landscape:',
        '**Catalog tools**',
        "- Bloomreach helped a retailer described as the UK's leading retailer with 27,000+ SKUs, restructure its catalog, delivering a +21% increase in AOV.",
        '- Width.ai focuses on product data.',
      ].join('\n\n'),
    );
  });

  it('keeps punctuation after a heading as a separate block', () => {
    expect(normalizeEvidenceMarkdown('## Heading\n\n.')).toBe('## Heading\n\n.');
  });

  it('keeps an ordinary paragraph separate from an unfinished list item', () => {
    const response = '- Deliberately unfinished\n\nA separate paragraph.';
    expect(normalizeEvidenceMarkdown(response)).toBe(response);
  });

  it('keeps a punctuation-led paragraph separate', () => {
    const response = '- Deliberately unfinished\n\n? What changed next?';
    expect(normalizeEvidenceMarkdown(response)).toBe(response);
  });

  it('preserves nested-list and indented-code structure', () => {
    const response = ['- Parent item', '  - Nested item', '', '    const answer = 42;'].join('\n');

    expect(normalizeEvidenceMarkdown(response)).toBe(response);
  });
});
