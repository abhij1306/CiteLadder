/** The Site Health internal-link analytics kinds. */
import type { AnalyticsKinds } from '../queue/executor.ts';
import { compensateInternalLinks, internalLinkJudge } from './internal-link-judgments.ts';
import { publishInternalLinks } from './internal-link-publish.ts';

export const internalLinkKinds = {
  internal_link_judgment: { run: internalLinkJudge(), compensate: compensateInternalLinks },
  internal_link_publish: { run: publishInternalLinks },
} as const satisfies AnalyticsKinds;
