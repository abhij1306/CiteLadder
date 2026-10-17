/**
 * Deterministic AI-referral classification (no model may guess a source).
 *
 * Connected-data config owns the rule tables.
 * Tiers run in a fixed order (referrer host, then UTM, then user agent) and
 * the first rule to fire within a tier wins.
 */
import { domainMatches } from '../analysis/domains.ts';
import { policy } from '../config.ts';

const { referrals } = policy;

export type RuleMatch = {
  ai_source: string;
  logical_engine: string | null;
  matched_rule_id: string;
  match_signal: string;
  confidence: string;
};

export type ReferralSignals = {
  referrer_host?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  user_agent?: string | null;
};

const ENGINES: Readonly<Record<string, string>> = referrals.source_to_logical_engine;

// The rule literals are ASCII, where lowercasing and case folding agree.
const normalize = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

function match(
  rule: { rule_id: string; ai_source: string; confidence: string },
  signal: string,
): RuleMatch {
  return {
    ai_source: rule.ai_source,
    logical_engine: Object.hasOwn(ENGINES, rule.ai_source) ? ENGINES[rule.ai_source]! : null,
    matched_rule_id: rule.rule_id,
    match_signal: signal,
    confidence: rule.confidence,
  };
}

function matchReferrerHost(referrerHost: string | null | undefined): RuleMatch | null {
  const host = normalize(referrerHost);
  if (!host) return null;
  // Boundary-safe: "notchatgpt.com" never matches "chatgpt.com".
  const rule = referrals.host_rules.find((candidate) => domainMatches(host, candidate.host));
  return rule ? match(rule, referrals.match_signals.referrer) : null;
}

function matchUtm(
  utmSource: string | null | undefined,
  utmMedium: string | null | undefined,
): RuleMatch | null {
  const source = normalize(utmSource);
  const medium = normalize(utmMedium);
  if (!source && !medium) return null;
  // A host-like rule source also matches its subdomains ("www.perplexity.ai"),
  // boundary-safe like the referrer tier; bare tokens stay exact.
  const sourceMatches = (expected: string) =>
    expected === source || (expected.includes('.') && domainMatches(source, expected));
  const rule = referrals.utm_rules.find(
    (candidate: { utm_source: string | null; utm_medium: string | null }) =>
      (candidate.utm_source === null || sourceMatches(candidate.utm_source)) &&
      (candidate.utm_medium === null || candidate.utm_medium === medium),
  );
  return rule ? match(rule, referrals.match_signals.utm) : null;
}

function matchUserAgent(userAgent: string | null | undefined): RuleMatch | null {
  const ua = normalize(userAgent);
  if (!ua) return null;
  const rule = referrals.ua_rules.find((candidate) => ua.includes(candidate.substring));
  return rule ? match(rule, referrals.match_signals.user_agent) : null;
}

/** The one deterministic outcome for a signal set, or null (`other`). */
export function classifyReferralSignals(signals: ReferralSignals): RuleMatch | null {
  return (
    matchReferrerHost(signals.referrer_host) ??
    matchUtm(signals.utm_source, signals.utm_medium) ??
    matchUserAgent(signals.user_agent)
  );
}
