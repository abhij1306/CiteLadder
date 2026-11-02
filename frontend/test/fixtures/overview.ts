import { http, HttpResponse, type JsonBodyType } from 'msw';

import type { OverviewWidgetKey } from '@citeladder/contracts/overview';

/**
 * An Overview whose command center never answers and whose saved layout shows
 * `widgets`. Every request is recorded in `asked`, so a test can show which
 * reads started while the command center was still pending.
 */
export function pendingOverviewHandlers(
  projectId: string,
  widgets: readonly OverviewWidgetKey[],
  asked: string[],
) {
  const root = `/api/v1/projects/${projectId}`;
  return [
    http.get(`${root}/command-center`, () => {
      asked.push('command-center');
      return new Promise<never>(() => {});
    }),
    http.get(`${root}/overview/layout`, () => {
      asked.push('layout');
      return HttpResponse.json({
        widgets: widgets.map((key) => ({ key, size: 'half' })),
        version: 0,
        customized: true,
        updated_at: null,
      });
    }),
  ];
}

/** A GET under the project that records `label` (plus its query string) and answers `body`. */
export function recordedProjectRead(
  projectId: string,
  path: string,
  label: string,
  asked: string[],
  body: JsonBodyType,
) {
  return http.get(`/api/v1/projects/${projectId}/${path}`, ({ request }) => {
    asked.push(`${label}${new URL(request.url).search}`);
    return HttpResponse.json(body);
  });
}
