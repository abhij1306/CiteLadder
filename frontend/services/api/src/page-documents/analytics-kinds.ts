/** The page-fetch analytics kind. */
import type { AnalyticsKinds } from '../queue/executor.ts';
import { compensatePageFetch, pageFetchTask } from './fetch-task.ts';
import { PAGE_FETCH_KIND } from './keys.ts';

export const pageDocumentKinds = {
  [PAGE_FETCH_KIND]: { run: pageFetchTask(), compensate: compensatePageFetch() },
} as const satisfies AnalyticsKinds;
