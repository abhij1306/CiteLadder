import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { reportClientError, setReportingWorkspace } from './client-errors';

const sink = vi.fn((_url: string, _init: RequestInit) =>
  Promise.resolve(new Response(null, { status: 204 })),
);

/** The workspace header and release each report carried. */
function sent() {
  return sink.mock.calls.map(([, init]) => ({
    workspace: new Headers(init.headers).get('X-Workspace-Id'),
    release: (JSON.parse(String(init.body)) as { release: string }).release,
  }));
}

beforeEach(() => vi.stubGlobal('fetch', sink));
afterEach(() => {
  vi.unstubAllGlobals();
  document.head.querySelector('meta[name="citeladder-release"]')?.remove();
  setReportingWorkspace(null);
});

describe('Client error reports', () => {
  it('scope to the active workspace and name the release index.html carries, at report time', () => {
    reportClientError({ kind: 'unhandled', error: new Error('before any selection') });
    const meta = document.createElement('meta');
    meta.name = 'citeladder-release';
    meta.content = '3f9a1c2';
    document.head.append(meta);
    setReportingWorkspace('6f1d3a52-0000-4000-8000-000000000001');
    reportClientError({ kind: 'unhandled', error: new Error('after selection') });

    expect(sent()).toEqual([
      { workspace: null, release: 'development' },
      { workspace: '6f1d3a52-0000-4000-8000-000000000001', release: '3f9a1c2' },
    ]);
  });
});
