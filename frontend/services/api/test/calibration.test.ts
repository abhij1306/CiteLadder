import { expect, it } from 'vitest';

import { policy } from '../src/config.ts';
import { calibrationReport } from '../src/prompts/calibration.ts';

it('separates gate outcomes from reviewed outcomes and excludes older question schemas', () => {
  const decision = {
    question_schema_version: policy.models.quality.question_schema_version,
    answers: Object.fromEntries(
      Object.keys(policy.models.quality.noul_questions).map((key) => [key, 0.01]),
    ),
  };
  const report = calibrationReport([
    { decision, disposition: 'accepted', category: 'Shoes', grounded: true },
    { decision, disposition: 'rejected', category: 'Shoes', grounded: false },
    { decision, disposition: 'gate_rejected', category: 'Shoes', grounded: true },
    {
      decision: { ...decision, question_schema_version: 'old' },
      disposition: 'accepted',
      category: 'Shoes',
      grounded: false,
    },
  ]);
  expect(report).toMatchObject({
    accepted: 1,
    rejected: 1,
    gate_rejected: 1,
    other_schema_decisions: 1,
    false_reject_rate: 1,
    false_accept_rate: 0,
    by_category: { Shoes: { reviewed: 2, agreement: 0.5 } },
    by_grounding: {
      grounded: { gate_rejected: 1, accepted: 1, rejected: 0, accept_rate: 1 },
      ungrounded: { gate_rejected: 0, accepted: 0, rejected: 1, accept_rate: 0 },
    },
  });
  expect(calibrationReport([]).false_reject_rate).toBeNull();
});
