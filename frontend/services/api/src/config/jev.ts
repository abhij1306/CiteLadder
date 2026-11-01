/** Versioned bounded quality judgments; decisions retain their original thresholds.
 * Thresholds are provisional and calibrated from user outcomes. Change policy_version
 * with thresholds. A blank API key disables the judge; deployments must authorize
 * this customer-data processor before configuring a key.
 */
import { ConfigError } from './config-error.ts';

export const jev = {
  api_key: {
    env: ['JEV_API_KEY'],
    type: 'str',
    default: '',
  },
  base_url: {
    env: ['JEV_BASE_URL'],
    type: 'str',
    default: 'https://api.typesafe.ai',
  },
  model: {
    env: ['JEV_MODEL'],
    type: 'str',
    default: 'jev-latest',
  },
  timeout_seconds: {
    env: ['JEV_TIMEOUT_SECONDS'],
    type: 'float',
    default: 10,
    exclusive_minimum: 0,
    maximum: 60,
  },
  max_attempts: {
    env: ['JEV_MAX_ATTEMPTS'],
    type: 'int',
    default: 3,
    minimum: 1,
    maximum: 5,
  },
  backoff_seconds: {
    env: ['JEV_BACKOFF_SECONDS'],
    type: 'float',
    default: 0.5,
    minimum: 0,
    maximum: 10,
  },
  max_calls_per_generation: {
    env: ['JEV_MAX_CALLS_PER_GENERATION'],
    type: 'int',
    default: 100,
    minimum: 1,
    maximum: 500,
  },
  generation_deadline_seconds: {
    env: ['JEV_GENERATION_DEADLINE_SECONDS'],
    type: 'float',
    default: 30,
    exclusive_minimum: 0,
    maximum: 120,
  },
  duplicate_options_max: {
    env: ['JEV_DUPLICATE_OPTIONS_MAX'],
    type: 'int',
    default: 20,
    minimum: 1,
    maximum: 100,
  },
  mode: {
    env: ['JEV_MODE'],
    type: 'literal',
    values: ['gate', 'shadow'],
    default: 'gate',
  },
  flag_below: {
    env: ['JEV_FLAG_BELOW'],
    type: 'float',
    default: 0.35,
    minimum: 0,
    maximum: 1,
  },
  duplicate_flag_at: {
    env: ['JEV_DUPLICATE_FLAG_AT'],
    type: 'float',
    default: 0.6,
    minimum: 0,
    maximum: 1,
  },
  fail_below: {
    env: ['JEV_FAIL_BELOW'],
    type: 'float',
    default: 0.15,
    minimum: 0,
    maximum: 1,
  },
  duplicate_fail_at: {
    env: ['JEV_DUPLICATE_FAIL_AT'],
    type: 'float',
    default: 0.85,
    minimum: 0,
    maximum: 1,
  },
  /** Provisional thresholds of the core-only `names_a_business` question, calibrated apart. */
  answerable_flag_below: {
    env: ['JEV_ANSWERABLE_FLAG_BELOW'],
    type: 'float',
    default: 0.4,
    minimum: 0,
    maximum: 1,
  },
  answerable_fail_below: {
    env: ['JEV_ANSWERABLE_FAIL_BELOW'],
    type: 'float',
    default: 0.15,
    minimum: 0,
    maximum: 1,
  },
};

export const quality = {
  question_schema_version: 'prompt-quality-questions-1',
  policy_version: 'jev-gate-1',
  retry_after_cap_seconds: 10,
  calibration_sweep: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5],
  mode_gate: 'gate',
  mode_shadow: 'shadow',
  verdict_pass: 'pass',
  verdict_uncertain: 'uncertain',
  verdict_fail: 'fail',
  flag_incomplete: 'incomplete',
  noul_questions: {
    decision_value: {
      instructions:
        'Does `candidate.question` express a meaningful buyer decision or selection need, beyond restating a product category and location? A question wrapper or words like best, online or stores alone do not add decision value. Concise requests can pass when a real problem, tradeoff, suitability need or purchasing constraint makes the answer useful. Do not require long or niche requests.',
      criteria: {
        true: 'A useful buying decision that could change the options chosen',
        false: 'A department label, category lookup or cosmetic variation',
      },
    },
    fits_business: {
      instructions:
        'Is `candidate.question` a question whose good answer could reasonably recommend or discuss a business like `business` -- within its category and offerings?',
      criteria: {
        true: 'The question is about what this kind of business offers',
        false: 'The question is about something this business does not offer',
      },
    },
    buyer_relevant: {
      instructions:
        'Would a real prospective buyer plausibly ask `candidate.question` while researching, comparing or choosing what to buy or hire?',
      criteria: {
        true: 'A buyer with a real need would ask this',
        false: 'Only a marketer, SEO tool or insider would ask this',
      },
    },
    natural: {
      instructions:
        'Does `candidate.question` read like something a person would type or say to an AI assistant?',
      criteria: {
        true: 'Natural wording a person would use',
        false: 'Keyword stuffing, marketing copy or robotic phrasing',
      },
    },
    standalone: {
      instructions:
        'Can `candidate.question` be understood and answered on its own, without missing context, placeholders or references to an earlier conversation?',
      criteria: {
        true: 'Self-contained',
        false: 'Depends on context the reader does not have',
      },
    },
    sensible: {
      instructions:
        'Is `candidate.question` coherent, combining needs, situations and constraints that make sense together?',
      criteria: {
        true: 'Coherent and realistic',
        false: 'Contradictory, impossible or nonsensical',
      },
    },
  },
  /**
   * Asked of core drafts only (branded diagnostics and comparisons name the
   * brand by design), under the `answerable_*` thresholds.
   */
  core_noul_questions: {
    names_a_business: {
      instructions:
        'Would a good answer to `candidate.question` mainly name specific businesses, products, providers or places to buy from, for one concise buyer need? A yes/no question, a request for general advice or instructions, or a question stacking several requirements is not.',
      criteria: {
        true: 'One concise need, answered by naming businesses or products',
        false: 'Answered with advice, a yes/no or an explanation, or it stacks several needs',
      },
    },
  },
  intent_instructions: 'What does the person asking `candidate.question` want from the answer?',
  intent_descriptions: {
    learn: 'To understand a topic or how something works',
    solve: 'To fix or work around a specific problem',
    compare: 'To compare named options or approaches',
    recommend: 'To get a recommendation of what or whom to choose',
    validate: 'To check whether a specific option is good or right for them',
    buy: 'To find where or how to purchase or hire',
    implement: 'To use, set up or get more out of something already chosen',
  },
  stage_instructions: 'How far along a buying decision is the person asking `candidate.question`?',
  stage_descriptions: {
    awareness: 'Exploring a need or problem, no options in mind yet',
    consideration: 'Weighing kinds of solutions or providers',
    decision: 'Choosing between specific options or ready to buy',
    implementation: 'Already chose and is using or setting it up',
  },
  duplicate_instructions:
    'Does `candidate.question` ask essentially the same thing as one of the numbered prompts, so that one AI answer would answer both? Choose that prompt, or `none` when every prompt asks something materially different.',
  duplicate_none: 'none',
  duplicate_none_description: 'No listed prompt asks the same thing',
};

export const qualityGatesReported = ['off', 'unavailable'];

/** Cross-field validation runs at startup. */
export function validateJevSettings(settings: Record<keyof typeof jev, unknown>): void {
  if (
    Number(settings.fail_below) > Number(settings.flag_below) ||
    Number(settings.answerable_fail_below) > Number(settings.answerable_flag_below) ||
    Number(settings.duplicate_fail_at) < Number(settings.duplicate_flag_at)
  )
    throw new ConfigError('Invalid JEV thresholds');
  let endpoint: URL;
  try {
    endpoint = new URL(String(settings.base_url));
  } catch {
    throw new ConfigError('JEV_BASE_URL must be a credential-free HTTPS URL');
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new ConfigError('JEV_BASE_URL must be a credential-free HTTPS URL');
}
