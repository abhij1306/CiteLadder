import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

// The classic script index.html runs before the app shell.
const script = readFileSync(join(import.meta.dirname, '../../public/browser-support.js'), 'utf8');

function runOnPage(): HTMLElement {
  document.documentElement.removeAttribute('data-browser-support');
  document.body.innerHTML = '<div id="root"></div>';
  // Runs the shipped classic script as the browser does.
  new Function(script)();
  const root = document.getElementById('root');
  if (!root) throw new Error('root missing');
  return root;
}

describe('browser-support.js', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('leaves the root to the app on a browser in the support matrix', () => {
    const root = runOnPage();

    expect(root.innerHTML).toBe('');
    expect(document.documentElement.dataset.browserSupport).toBeUndefined();
  });

  it('shows the update notice when URL.canParse is missing', () => {
    vi.stubGlobal('URL', function LegacyUrl() {});
    const root = runOnPage();

    expect(root.querySelector('h1')?.textContent).toBe('Update your browser');
    expect(root.querySelector('main p')?.textContent).toBe(
      'CiteLadder needs a newer browser. Update Chrome, Edge, Firefox, Safari or Samsung Internet to the latest version, then reload this page.',
    );
    expect(document.documentElement.dataset.browserSupport).toBe('unsupported');
  });

  it('shows the update notice when AbortSignal is absent altogether', () => {
    vi.stubGlobal('AbortSignal', undefined);
    const root = runOnPage();

    expect(root.querySelector('h1')?.textContent).toBe('Update your browser');
    expect(document.documentElement.dataset.browserSupport).toBe('unsupported');
  });
});
