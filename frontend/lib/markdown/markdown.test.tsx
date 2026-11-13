import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { ContentMarkdown } from './markdown';
import { leavesForUnknownHost, linkHost, safeUrlTransform } from './safe-url';

afterEach(() => vi.restoreAllMocks());

/** A middle click, which opens a new tab without firing `click`. */
function auxClick(): MouseEvent {
  return new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
}

describe('linkHost', () => {
  it('reduces a URL or bare domain to its comparable host', () => {
    expect(linkHost('https://www.Acme.com/pricing?x=1')).toBe('acme.com');
    expect(linkHost('acme.com')).toBe('acme.com');
    expect(linkHost('shop.acme.com/path')).toBe('shop.acme.com');
    expect(linkHost('mailto:hi@acme.com')).toBeNull();
    expect(linkHost('  ')).toBeNull();
  });
});

describe('leavesForUnknownHost', () => {
  const known = ['acme.com', 'news.example'];

  it('lets known hosts and their subdomains, app paths and inert links open directly', () => {
    expect(leavesForUnknownHost('https://acme.com/pricing', known)).toBe(false);
    expect(leavesForUnknownHost('https://www.acme.com/', known)).toBe(false);
    expect(leavesForUnknownHost('https://blog.acme.com/post', known)).toBe(false);
    expect(leavesForUnknownHost('https://news.example/story', known)).toBe(false);
    expect(leavesForUnknownHost('/agent/chats', known)).toBe(false);
    expect(leavesForUnknownHost('#user-content-fn-1', known)).toBe(false);
    expect(leavesForUnknownHost('', known)).toBe(false);
  });

  it('asks before any other host, look-alike hosts and mail links', () => {
    expect(leavesForUnknownHost('https://evil.example/?data=secret', known)).toBe(true);
    expect(leavesForUnknownHost('https://acme.com.evil.example/', known)).toBe(true);
    expect(leavesForUnknownHost('https://notacme.com/', known)).toBe(true);
    expect(leavesForUnknownHost('https://acme.com@evil.example/', known)).toBe(true);
    expect(leavesForUnknownHost('mailto:x@acme.com?body=secret', known)).toBe(true);
  });

  it('judges a path the browser reads as another host by that host', () => {
    const app = 'https://app.citeladder.example';
    expect(leavesForUnknownHost('/\\evil.example/path?d=1', known, app)).toBe(true);
    expect(leavesForUnknownHost('/agent/chats', known, app)).toBe(false);
    expect(leavesForUnknownHost('https://app.citeladder.example/agent', known, app)).toBe(false);
  });
});

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

  it('opens a link to a known host directly', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(
      <ContentMarkdown
        markdown={'[Pricing](https://acme.com/pricing)'}
        knownHosts={['acme.com']}
      />,
    );
    const link = screen.getByRole('link', { name: 'Pricing' });

    // `fireEvent` returns false when a handler cancelled the browser's navigation.
    expect(fireEvent.click(link)).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://acme.com/pricing');
    expect(open).not.toHaveBeenCalled();
  });

  it('confirms a link to an unknown host, showing its full address, before opening it', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const url = 'https://evil.example/collect?brand=Acme&notes=private';
    render(<ContentMarkdown markdown={`[See more](${url})`} knownHosts={['acme.com']} />);

    expect(fireEvent.click(screen.getByRole('link', { name: 'See more' }))).toBe(false);
    const dialog = screen.getByRole('dialog', { name: 'You’re leaving CiteLadder' });
    expect(dialog).toHaveTextContent(url);
    expect(open).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
    expect(open.mock.calls).toEqual([[url, '_blank', 'noopener,noreferrer']]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens nothing when the leave confirm is cancelled, including after a middle click', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(
      <ContentMarkdown markdown={'[x](https://evil.example/?q=1)'} knownHosts={['acme.com']} />,
    );

    expect(fireEvent(screen.getByRole('link', { name: 'x' }), auxClick())).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it('drops images entirely', () => {
    const { container } = render(
      <ContentMarkdown markdown={'![tracker](https://evil.example/pixel.png)'} />,
    );
    expect(container.querySelector('img')).toBeNull();
  });
});
