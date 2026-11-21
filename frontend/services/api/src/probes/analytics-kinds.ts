import type { AnalyticsKinds } from '../queue/executor.ts';
import { compensateProbeLabelling, probeLabelling } from './labelling.ts';

export const probeKinds = {
  probe_labelling: { run: probeLabelling(), compensate: compensateProbeLabelling },
} as const satisfies AnalyticsKinds;
