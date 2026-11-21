import { http, HttpResponse, type JsonBodyType } from 'msw';

import type { OverviewWidgetKey } from '@citeladder/contracts/overview';

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
