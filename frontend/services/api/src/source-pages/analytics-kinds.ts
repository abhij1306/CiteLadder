/** The earned-source analytics kind. */
import type { AnalyticsKinds } from '../queue/executor.ts';
import { compensateInspection, sourcePageInspector } from './inspector.ts';

export const sourcePageKinds = {
  source_page_inspection: { run: sourcePageInspector(), compensate: compensateInspection },
} as const satisfies AnalyticsKinds;
