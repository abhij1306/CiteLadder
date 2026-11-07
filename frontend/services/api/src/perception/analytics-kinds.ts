/** The answer perception and fact verification analytics kinds. */
import type { AnalyticsKinds } from '../queue/executor.ts';
import { answerPerception, compensatePerception } from './executor.ts';
import { compensateFactVerification, factVerification } from './fact-verification.ts';

export const perceptionKinds = {
  answer_perception: { run: answerPerception(), compensate: compensatePerception },
  fact_verification: { run: factVerification(), compensate: compensateFactVerification },
} as const satisfies AnalyticsKinds;
