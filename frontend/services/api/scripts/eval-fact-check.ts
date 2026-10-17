/**
 * Live fact-check calibration: each hand-labelled answer through the
 * perception call with the claims addendum, the claim validator, the
 * verification call and the verdict validator, the way a pilot audit runs
 * them (same parse retry, same frozen topic scope). Scored for
 * false-contradiction rate (the pilot gate), verdict agreement, quote validity
 * and tokens per answer against the configured thresholds; topic agreement is
 * reported beside them. A reply that stays unusable after the retry fails its
 * fixture (its expected claims count as failed) instead of aborting the run.
 * Operator-run only (it calls the provider and spends platform budget); never
 * part of CI. Records append to one log in the worktree's Git directory.
 */
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { claimVerdictSchema, factTopicSchema } from '@citeladder/contracts/fact-checking';
import { z } from 'zod';

import { scoringConfig } from '../src/analysis/scoring.ts';
import { policy } from '../src/config.ts';
import { createModelGateway } from '../src/models/gateway.ts';
import { checkedTopics, factScope, type FrozenFactCheck } from '../src/perception/admission.ts';
import { callStructured } from '../src/perception/model-call.ts';
import { claimsOutputSchema, perceptionPrompt } from '../src/perception/model.ts';
import { entityPassages, type PerceptionPackage } from '../src/perception/passages.ts';
import { validateClaims, validateOutput } from '../src/perception/validate.ts';
import {
  validateVerdicts,
  verifyHash,
  verifyOutputSchema,
  verifyPackage,
  verifyPrompt,
} from '../src/perception/verify.ts';
import raw from '../test/fixtures/fact-check/answers.json' with { type: 'json' };
import { gitDirectory } from './git-directory.ts';

const { values } = parseArgs({
  options: { live: { type: 'boolean', default: false }, fixture: { type: 'string' } },
});
if (!values.live)
  throw new Error('Calibration calls the configured model provider; pass --live to run it');
const fixtures = z
  .object({
    brands: z.array(
      z.object({
        brand_name: z.string(),
        competitors: z.array(z.string()),
        prompt: z.string(),
        facts: z.array(z.object({ topic: factTopicSchema, statement: z.string() })),
      }),
    ),
    answers: z.array(
      z.object({
        name: z.string(),
        brand_name: z.string(),
        answer: z.string(),
        expected: z.array(
          z.object({
            quote_contains: z.string(),
            topic: factTopicSchema,
            verdict: claimVerdictSchema,
          }),
        ),
      }),
    ),
  })
  .parse(raw);
const settings = policy.perception;
const facts = settings.fact_check;
const gateway = createModelGateway();
const log = join(gitDirectory(process.cwd()), 'fact-check-eval.log');
const run = new Date().toISOString();
const brands = new Map(fixtures.brands.map((brand) => [brand.brand_name, brand]));

type Answer = (typeof fixtures.answers)[number];
type Brand = (typeof fixtures.brands)[number];
type Actual = { quote: string; topic: string; verdict: string };

// Some adapters report only input and output tokens; count those rather than zero.
const tokensOf = (call: { usage: Record<string, unknown> | null }) =>
  Number(
    call.usage?.total_tokens ??
      Number(call.usage?.input_tokens ?? 0) + Number(call.usage?.output_tokens ?? 0),
  );

/** The brand's facts frozen the way admission freezes them, so scope and coverage match a pilot audit. */
function frozen(brand: Brand): FrozenFactCheck {
  return {
    claims_version: facts.claims_version,
    verify_template_version: facts.verify_template_version,
    metrics_version: facts.metrics_version,
    fact_set_hash: 'calibration',
    facts: brand.facts.map((fact, index) => ({
      revision_id: `fixture-${index}`,
      topic: fact.topic,
    })),
    related_topics: facts.related_topics,
  };
}

/** Extraction then verification; the failed step instead when a reply stays unusable. */
async function pipeline(fixture: Answer, brand: Brand) {
  const pkg: PerceptionPackage = {
    extractor_version: settings.extractor_version,
    template_version: `${settings.template_version}+${facts.claims_version}`,
    language: 'en',
    prompt: brand.prompt,
    entities: entityPassages({
      answer: fixture.answer,
      languageCode: 'en',
      config: scoringConfig({
        brand_name: brand.brand_name,
        competitors: brand.competitors.map((name) => ({ name, domains: [] })),
      }),
      policy: settings,
    }),
  };
  const extraction = await callStructured(
    gateway,
    {
      ...perceptionPrompt(pkg, settings, facts),
      schema: claimsOutputSchema,
      inputHash: '',
      maxAttempts: settings.max_attempts,
    },
    (value) => {
      validateOutput(pkg, value, settings);
      return { outcome: 'classified' as const, ...validateClaims(pkg, value.claims, facts) };
    },
  );
  if (extraction.outcome.outcome !== 'classified')
    return {
      failed: `extraction_${extraction.outcome.outcome}`,
      tokens: tokensOf(extraction.call),
    };
  const claims = extraction.outcome;
  const factCheck = frozen(brand);
  const topics = checkedTopics(factCheck);
  const eligible = claims.claims.filter(
    (claim) => !claim.low_confidence && topics.has(claim.topic),
  );
  const verdicts = new Map<string, string>();
  let tokens = tokensOf(extraction.call);
  if (eligible.length) {
    const built = verifyPackage({
      version: facts.verify_template_version,
      brand: brand.brand_name,
      language: 'en',
      facts: brand.facts.map((fact, index) => ({ revisionId: `fixture-${index}`, ...fact })),
      claims: eligible.map((claim) => ({
        claimId: String(claim.ordinal),
        topic: claim.topic,
        claim: claim.claim,
        quote: claim.quote,
      })),
      scope: (topic) => factScope(factCheck, topic),
      maxFacts: facts.max_facts_per_verification,
    });
    const verification = await callStructured(
      gateway,
      {
        ...verifyPrompt(built.pkg, facts),
        schema: verifyOutputSchema,
        inputHash: verifyHash(built.pkg),
        maxAttempts: facts.max_attempts,
      },
      (value) => ({ outcome: 'verified' as const, ...validateVerdicts(value, built, facts) }),
    );
    tokens += tokensOf(verification.call);
    if (verification.outcome.outcome !== 'verified')
      return { failed: `verification_${verification.outcome.outcome}`, tokens };
    for (const verdict of verification.outcome.verdicts)
      verdicts.set(verdict.claimId, verdict.lowConfidence ? 'low_confidence' : verdict.verdict);
  }
  const actual: Actual[] = claims.claims.map((claim) => ({
    quote: claim.quote,
    topic: claim.topic,
    verdict: claim.low_confidence
      ? 'low_confidence'
      : (verdicts.get(String(claim.ordinal)) ?? 'not_covered'),
  }));
  return {
    actual,
    kept: claims.claims.length,
    invented: claims.drops.claim_quote_not_found ?? 0,
    tokens,
  };
}

async function evaluate(fixture: Answer) {
  const brand = brands.get(fixture.brand_name);
  if (!brand) throw new Error(`Fixture ${fixture.name} names an unknown brand`);
  const result = await pipeline(fixture, brand);
  const base = {
    run,
    fixture: fixture.name,
    claims_version: facts.claims_version,
    verify_template_version: facts.verify_template_version,
    total_tokens: result.tokens,
  };
  if ('failed' in result)
    return {
      ...base,
      failed: result.failed,
      matched: fixture.expected.map((expected) => ({
        expected: expected.verdict,
        actual: 'failed',
        topic_match: false,
      })),
      unexpected: [],
      contradicted: 0,
      false_contradictions: 0,
      kept: 0,
      invented: 0,
    };
  const { actual } = result;
  // Quote first: the verdict is scored on the claim that quotes the expected words.
  const matched = fixture.expected.map((expected) => {
    const claim = actual.find((row) => row.quote.includes(expected.quote_contains));
    return {
      expected: expected.verdict,
      actual: claim?.verdict ?? 'missed',
      topic_match: claim?.topic === expected.topic,
    };
  });
  const expectedQuotes = fixture.expected.map((expected) => expected.quote_contains);
  const contradicted = actual.filter((claim) => claim.verdict === 'contradicted');
  const falseContradictions = contradicted.filter(
    (claim) =>
      !fixture.expected.some(
        (expected) =>
          expected.verdict === 'contradicted' && claim.quote.includes(expected.quote_contains),
      ),
  );
  return {
    ...base,
    failed: null,
    matched,
    unexpected: actual.filter(
      (claim) => !expectedQuotes.some((quote) => claim.quote.includes(quote)),
    ),
    contradicted: contradicted.length,
    false_contradictions: falseContradictions.length,
    kept: result.kept,
    invented: result.invented,
  };
}

const selected = fixtures.answers.filter((item) => !values.fixture || item.name === values.fixture);
if (!selected.length) throw new Error(`No calibration fixture is named ${values.fixture}`);
const records = await Promise.all(selected.map(evaluate));
await appendFile(log, records.map((record) => `${JSON.stringify(record)}\n`).join(''));

const sum = (pick: (record: (typeof records)[number]) => number) =>
  records.reduce((total, record) => total + pick(record), 0);
const pairs = records.flatMap((record) => record.matched);
const share = (count: number) => (pairs.length ? count / pairs.length : 1);
const agreement = share(pairs.filter((pair) => pair.expected === pair.actual).length);
const topicAgreement = share(pairs.filter((pair) => pair.topic_match).length);
const failedFixtures = records.filter((record) => record.failed !== null).length;
const contradicted = sum((record) => record.contradicted);
const falseRate = contradicted ? sum((record) => record.false_contradictions) / contradicted : 0;
const kept = sum((record) => record.kept);
const invented = sum((record) => record.invented);
const quoteValidity = kept + invented ? kept / (kept + invented) : 1;
const tokens = sum((record) => record.total_tokens) / records.length;
const limits = facts.eval_thresholds;
const failures = [
  falseRate > limits.max_false_contradiction_rate && 'false_contradiction_rate',
  agreement < limits.min_verdict_agreement && 'verdict_agreement',
  quoteValidity < limits.min_quote_validity && 'quote_validity',
  tokens > limits.max_total_tokens_per_answer && 'tokens_per_answer',
].filter(Boolean);
const verdict = failures.length ? 'failed ' + failures.join(', ') : 'within thresholds';
process.stdout.write(
  `${records.length} answers (${failedFixtures} failed replies), ${pairs.length} expected claims ` +
    `(${facts.eval_policy_version}): false contradictions ${falseRate.toFixed(2)} of ${contradicted}, ` +
    `verdict agreement ${agreement.toFixed(2)}, topic agreement ${topicAgreement.toFixed(2)}, ` +
    `quote validity ${quoteValidity.toFixed(2)}, tokens/answer ${Math.round(tokens)}; ${verdict}\n` +
    `Log: ${log}\n`,
);
