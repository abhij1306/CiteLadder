import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { hardNavigate } from './hard-navigate';

/**
 * `lib/navigation` had no tests. The module's own docstring says it exists so
 * that "this click navigated instead of posting" is assertable — this is that
 * assertion, and it also pins the indirection in place: inlining
 * `window.location.assign` back into a component would make these fail.
 */
describe('hardNavigate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves the SPA via a full-page assignment', () => {
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      assign,
    } as unknown as Location);

    hardNavigate('https://provider.example/oauth/authorize?state=abc');

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('https://provider.example/oauth/authorize?state=abc');
  });

  it('passes a relative URL through unchanged', () => {
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      assign,
    } as unknown as Location);

    // A relative URL must NOT be rewritten here: the whole point is a full
    // document load so session state is re-read on return.
    hardNavigate('/api/v1/integrations/callback?next=/settings');

    expect(assign).toHaveBeenCalledWith('/api/v1/integrations/callback?next=/settings');
  });
});
