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

    hardNavigate('https://checkout.example/session/abc');

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('https://checkout.example/session/abc');
  });

  it('passes a relative auth bounce through unchanged', () => {
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      assign,
    } as unknown as Location);

    // A relative URL must NOT be rewritten here: the whole point is a full
    // document load so session state is re-read on return.
    hardNavigate('/login?next=/pricing');

    expect(assign).toHaveBeenCalledWith('/login?next=/pricing');
  });
});
