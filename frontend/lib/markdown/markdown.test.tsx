import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { ContentMarkdown } from './markdown';
import { safeUrlTransform } from './safe-url';

describe('safeUrlTransform', () => {
  it('allows http/https/mailto and relative URLs', () => {
    expect(safeUrlTransform('https://example.com/a')).toBe('https://example.com/a');
    expect(safeUrlTransform('http://example.com')).toBe('http://example.com');
    expect(safeUrlTransform('mailto:hi@example.com')).toBe('mailto:hi@example.com');
    expect(safeUrlTransform('/pricing')).toBe('/pricing');
  });

  it('neutralises javascript:, data:, and vbscript: URLs', () => {
    expect(safeUrlTransform('javascript:alert(1)')).toBe('');
    expect(safeUrlTransform(' javascript:alert(1)')).toBe('');
    expect(safeUrlTransform('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(safeUrlTransform('vbscript:msgbox(1)')).toBe('');
    expect(safeUrlTransform('JAVASCRIPT:alert(1)')).toBe('');
  });

  it('neutralises protocol-relative URLs', () => {
    // `//evil.example/x` resolves to a `https:` URL against the fallback origin,
    // so the protocol allowlist alone lets it through — and the browser would
    // then resolve the returned value against the app's own origin and navigate
    // off-site. Relative paths must keep working (asserted above).
    expect(safeUrlTransform('//evil.example/x')).toBe('');
    expect(safeUrlTransform('  //evil.example/x')).toBe('');
    expect(safeUrlTransform('//')).toBe('');
  });
});

describe('ContentMarkdown', () => {
  it('renders headings, lists, and GFM tables', () => {
    render(
      <ContentMarkdown markdown={'# Title\n\n- one\n- two\n\n| A | B |\n| - | - |\n| 1 | 2 |'} />,
    );
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('demotes every generated heading below the route-owned h1', () => {
    render(
      <ContentMarkdown markdown={'# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six'} />,
    );

    expect(screen.getByRole('heading', { name: 'One', level: 2 })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Two', level: 3 })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Three', level: 4 })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Four', level: 5 })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Five', level: 6 })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Six', level: 6 })).toBeVisible();
  });

  it('preserves leading indentation in the original Markdown', () => {
    const { container } = render(<ContentMarkdown markdown={'    indented code\n'} />);

    expect(container.querySelector('pre code')).toHaveTextContent('indented code');
  });

  it('contains long generated URLs, code, and tables within the reading surface', () => {
    const { container } = render(
      <ContentMarkdown
        markdown={`https://example.com/${'long-path-segment'.repeat(20)}\n\n\`\`\`text\n${'code'.repeat(80)}\n\`\`\`\n\n| Value |\n| - |\n| ${'cell'.repeat(80)} |`}
      />,
    );

    expect(container).toHaveTextContent('https://example.com/');
    expect(container).toHaveTextContent('code'.repeat(80));
    expect(container).toHaveTextContent('cell'.repeat(80));
    expect(container.querySelector('pre code')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeInTheDocument();
  });

  it('never parses raw HTML (script/iframe arrive as escaped text)', () => {
    const { container } = render(
      <ContentMarkdown markdown={'hello <script>window.pwned = true</script> <b>bold?</b>'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect((window as { pwned?: boolean }).pwned).toBeUndefined();
  });

  it('neutralises javascript: links and hardens external ones', () => {
    render(
      <ContentMarkdown markdown={'[bad](javascript:alert(1)) and [good](https://example.com)'} />,
    );
    const good = screen.getByRole('link', { name: 'good' });
    expect(good).toHaveAttribute('href', 'https://example.com');
    expect(good).toHaveAttribute('rel', 'noopener noreferrer');
    expect(good).toHaveAttribute('target', '_blank');
    const bad = screen.getByText('bad').closest('a');
    expect(bad?.getAttribute('href') ?? '').toBe('');
  });

  it('drops images entirely', () => {
    const { container } = render(
      <ContentMarkdown markdown={'![tracker](https://evil.example/pixel.png)'} />,
    );
    expect(container.querySelector('img')).toBeNull();
  });
});
