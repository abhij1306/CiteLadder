import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

const script = readFileSync(join(import.meta.dirname, '../../public/browser-support.js'), 'utf8');

function runOnPage(): HTMLElement {
  document.documentElement.removeAttribute('data-browser-support');
  document.body.innerHTML = '<div id="root"><div class="boot-shell"></div></div>';
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

    expect(root.innerHTML).toBe('<div class="boot-shell"></div>');
    expect(document.documentElement.dataset.browserSupport).toBeUndefined();
  });

  it('shows the update notice when URL.canParse is missing', () => {
    vi.stubGlobal('URL', function LegacyUrl() {});
    const root = runOnPage();

    expect(root.querySelector('h1')?.textContent).toBe('Update your browser');
    expect(root.querySelector('.boot-shell')).toBeNull();
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

  it('shows the update notice when CSS light-dark() is unsupported (Chrome 122, Safari 17.4)', () => {
    vi.stubGlobal('CSS', {
      supports: (_property: string, value: string) => !value.startsWith('light-dark('),
    });
    const root = runOnPage();

    expect(root.querySelector('h1')?.textContent).toBe('Update your browser');
    expect(document.documentElement.dataset.browserSupport).toBe('unsupported');
  });
});
