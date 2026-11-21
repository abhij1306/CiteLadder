import {
  claimUnavailableReasonSchema,
  type AccuracyClaim,
  type AccuracyCoverage,
  type AccuracyFact,
  type AccuracyResponse,
  type AccuracyScore,
  type ClaimVerdict,
  type FactTopic,
  type OverrideVerdict,
} from '@citeladder/contracts/fact-checking';
import type { z } from 'zod';

import { compareText } from '../text-order.ts';
import { citedDomains, runPoints } from './metrics.ts';

export type UnavailableReason = z.infer<typeof claimUnavailableReasonSchema>;

export type ClaimStatus =
  | { kind: 'verdict'; verdict: ClaimVerdict }
  | { kind: 'low_confidence' }
  | { kind: 'pending' }
  | { kind: 'unavailable'; reason: UnavailableReason };

type FactRef = AccuracyClaim['facts'][number];
export type FactRevision = FactRef & { revision_id: string; fact_id: string; revision: number };

export type ClaimRow = {
  ordinal: number;
  claim: string;
  topic: FactTopic;
  quote: string;
  start: number;
  end: number;
  status: ClaimStatus;
  facts: FactRevision[];
  verdictId: string | null;
  edited: AccuracyClaim['edited'];
};

export type Extraction =
  | { kind: 'done' }
  | { kind: 'pending' }
  | { kind: 'unavailable'; reason: UnavailableReason };

export type FactAnswer = {
  auditId: string;
  executionId: string;
  observedAt: string;
  logicalEngine: string;
  prompt: string;
  identity: string;
  extraction: Extraction;
  claims: ClaimRow[];
  citations: { domain: string; url: string }[];
};

export function unavailableReason(row: {
  outcome: string;
  outcome_reason: string | null;
}): UnavailableReason | null {
  if (row.outcome === 'invalid_output' || row.outcome === 'model_error') return row.outcome;
  if (row.outcome !== 'unavailable') return null;
  const reason = claimUnavailableReasonSchema.safeParse(row.outcome_reason);
  return reason.success ? reason.data : 'task_failed';
}

export function claimStatus(input: {
  lowConfidenceClaim: boolean;
  topicHasFact: boolean;
  verification: { outcome: string; outcome_reason: string | null } | undefined;
  verdict:
    | {
        verdict: ClaimVerdict;
        low_confidence: boolean;
        model_omitted: boolean;
        override: OverrideVerdict | null;
      }
    | undefined;
}): ClaimStatus {
  if (input.lowConfidenceClaim) return { kind: 'low_confidence' };
  if (!input.topicHasFact) return { kind: 'verdict', verdict: 'not_covered' };
  if (!input.verification) return { kind: 'pending' };
  const reason = unavailableReason(input.verification);
  if (reason) return { kind: 'unavailable', reason };
  if (!input.verdict) return { kind: 'verdict', verdict: 'not_covered' };
  if (input.verdict.model_omitted) return { kind: 'unavailable', reason: 'model_omitted' };
  if (input.verdict.override) return { kind: 'verdict', verdict: input.verdict.override };
  if (input.verdict.low_confidence) return { kind: 'low_confidence' };
  return { kind: 'verdict', verdict: input.verdict.verdict };
}

function emptyCoverage(): AccuracyCoverage {
  return {
    claims: 0,
    supported: 0,
    contradicted: 0,
    inconclusive: 0,
    not_covered: 0,
    low_confidence: 0,
    pending: 0,
    unavailable: [],
    answers_pending: 0,
    answers_unavailable: 0,
    edited: 0,
  };
}

function scoreClaims(
  claims: readonly Pick<ClaimRow, 'status' | 'edited'>[],
  extractions: readonly Extraction[] = [],
): AccuracyScore {
  const coverage = emptyCoverage();
  const unavailable = new Map<UnavailableReason, number>();
  for (const extraction of extractions) {
    if (extraction.kind === 'pending') coverage.answers_pending++;
    if (extraction.kind === 'unavailable') coverage.answers_unavailable++;
  }
  for (const { status, edited } of claims) {
    coverage.claims++;
    if (edited) coverage.edited++;
    if (status.kind === 'verdict') coverage[status.verdict]++;
    else if (status.kind === 'unavailable')
      unavailable.set(status.reason, (unavailable.get(status.reason) ?? 0) + 1);
    else coverage[status.kind]++;
  }
  coverage.unavailable = [...unavailable]
    .map(([reason, total]) => ({ reason, count: total }))
    .sort((a, b) => b.count - a.count || compareText(a.reason, b.reason));
  const decided = coverage.supported + coverage.contradicted;
  return { accuracy: decided ? coverage.supported / decided : null, coverage };
}

export function score(answers: readonly FactAnswer[]): AccuracyScore {
  return scoreClaims(
    answers.flatMap((answer) => answer.claims),
    answers.map((answer) => answer.extraction),
  );
}

function readState(
  answers: readonly FactAnswer[],
  factChecked: boolean,
  { coverage }: AccuracyScore,
): Pick<AccuracyResponse, 'state' | 'reason'> {
  if (!factChecked) return { state: 'no_facts', reason: null };
  const verdicts =
    coverage.supported + coverage.contradicted + coverage.inconclusive + coverage.not_covered;
  if (verdicts > 0) return { state: 'value', reason: null };
  if (coverage.pending > 0 || coverage.answers_pending > 0)
    return { state: 'pending', reason: null };
  const extraction = answers.flatMap((answer) =>
    answer.extraction.kind === 'unavailable' ? [answer.extraction.reason] : [],
  );
  const reason = coverage.unavailable[0]?.reason ?? extraction[0];
  if (reason) return { state: 'unavailable', reason };
  return { state: 'no_claims', reason: null };
}

function breakdown(
  answers: readonly FactAnswer[],
  key: (answer: FactAnswer, claim: ClaimRow) => string,
) {
  const groups = new Map<string, ClaimRow[]>();
  for (const answer of answers)
    for (const claim of answer.claims) {
      const groupKey = key(answer, claim);
      const group = groups.get(groupKey);
      if (group) group.push(claim);
      else groups.set(groupKey, [claim]);
    }
  return [...groups]
    .map(([groupKey, claims]) => ({ key: groupKey, label: groupKey, score: scoreClaims(claims) }))
    .sort((a, b) => b.score.coverage.claims - a.score.coverage.claims || compareText(a.key, b.key));
}

export type PositionedClaim = AccuracyClaim & { ordinal: number };

export function claimOrder(
  a: Pick<PositionedClaim, 'observed_at' | 'execution_id' | 'ordinal'>,
  b: Pick<PositionedClaim, 'observed_at' | 'execution_id' | 'ordinal'>,
) {
  return (
    compareText(b.observed_at, a.observed_at) ||
    compareText(a.execution_id, b.execution_id) ||
    a.ordinal - b.ordinal
  );
}

export function claimView(claim: ClaimRow) {
  const { status } = claim;
  return {
    claim: claim.claim,
    topic: claim.topic,
    quote: claim.quote,
    status: status.kind,
    verdict: status.kind === 'verdict' ? status.verdict : null,
    reason: status.kind === 'unavailable' ? status.reason : null,
    facts: claim.facts.map(({ topic, statement, source_url }) => ({
      topic,
      statement,
      source_url,
    })),
  };
}

export function factBreakdown(
  answers: readonly FactAnswer[],
  frozen: readonly FactRevision[],
): AccuracyFact[] {
  const tallies = new Map<
    string,
    { supported: number; contradicted: number; inconclusive: number; last: string }
  >();
  for (const answer of answers)
    for (const { status, facts } of answer.claims) {
      if (status.kind !== 'verdict' || status.verdict === 'not_covered') continue;
      for (const id of new Set(facts.map((fact) => fact.revision_id))) {
        const tally = tallies.get(id) ?? {
          supported: 0,
          contradicted: 0,
          inconclusive: 0,
          last: answer.observedAt,
        };
        tally[status.verdict]++;
        if (compareText(answer.observedAt, tally.last) > 0) tally.last = answer.observedAt;
        tallies.set(id, tally);
      }
    }
  const checking = answers.some(
    (answer) =>
      answer.extraction.kind === 'pending' ||
      answer.claims.some((claim) => claim.status.kind === 'pending'),
  );
  return frozen
    .map((fact): AccuracyFact => {
      const tally = tallies.get(fact.revision_id);
      return {
        revision_id: fact.revision_id,
        fact_id: fact.fact_id,
        revision: fact.revision,
        topic: fact.topic,
        statement: fact.statement,
        counts: tally
          ? {
              kind: 'raised',
              claims: tally.supported + tally.contradicted + tally.inconclusive,
              supported: tally.supported,
              contradicted: tally.contradicted,
              inconclusive: tally.inconclusive,
              last_raised_at: tally.last,
            }
          : { kind: checking ? 'pending' : 'not_raised' },
      };
    })
    .sort(
      (a, b) =>
        raisedClaims(b) - raisedClaims(a) ||
        compareText(a.statement, b.statement) ||
        b.revision - a.revision,
    );
}

function raisedClaims(fact: AccuracyFact) {
  return fact.counts.kind === 'raised' ? fact.counts.claims : -1;
}

export function positionedClaims(
  answers: readonly FactAnswer[],
  keep: (claim: ClaimRow) => boolean = () => true,
): PositionedClaim[] {
  return answers
    .flatMap((answer) =>
      answer.claims.filter(keep).map((claim) => ({
        ...claimView(claim),
        logical_engine: answer.logicalEngine,
        prompt: answer.prompt,
        run_id: answer.auditId,
        execution_id: answer.executionId,
        observed_at: answer.observedAt,
        verdict_id: claim.verdictId,
        edited: claim.edited,
        ordinal: claim.ordinal,
      })),
    )
    .sort(claimOrder);
}

function isContradicted(claim: { status: ClaimStatus }) {
  return claim.status.kind === 'verdict' && claim.status.verdict === 'contradicted';
}

export function accuracyTrend(answers: readonly FactAnswer[]) {
  return runPoints(answers, (first) => first.identity).map(
    ({ auditId, rows, completedAt, comparable }) => ({
      audit_id: auditId,
      completed_at: completedAt,
      score: score(rows),
      comparable,
    }),
  );
}

export function accuracySummary(
  answers: readonly FactAnswer[],
  factChecked: boolean,
  limits: { max_contradicted_claims: number; max_cited_alongside: number },
): Omit<AccuracyResponse, 'source_audit_ids'> {
  const total = score(answers);
  return {
    ...readState(answers, factChecked, total),
    score: total,
    topics: breakdown(answers, (_answer, claim) => claim.topic),
    engines: breakdown(answers, (answer) => answer.logicalEngine),
    contradicted: positionedClaims(answers, isContradicted)
      .slice(0, limits.max_contradicted_claims)
      .map(({ ordinal: _ordinal, ...claim }) => claim),
    cited_alongside: citedDomains(
      answers,
      (answer) => answer.claims.some(isContradicted),
      limits.max_cited_alongside,
    ),
    trend: accuracyTrend(answers),
  };
}
