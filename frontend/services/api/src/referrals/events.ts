/** Sanitize recorded referral signals before persisting immutable events. */
import { createHash } from 'node:crypto';

import { normalizeDomain } from '../analysis/domains.ts';
import { policy } from '../config.ts';
import type { NonEmpty } from '../lists.ts';

const { referrals } = policy;

export type MetricRowIdentity = { dataset: string; date: string; dimension_key: string };

type Signals = {
  landing_url: string;
  referrer_url: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
};

export type ReferralEventFields = Signals & {
  referrer_host: string;
  user_agent: string;
  session_id_hash: string;
  raw: Record<string, string>;
  content_hash: string;
};

function paramAllowed(name: string): boolean {
  return (
    referrals.url_param_allowlist.includes(name) ||
    referrals.url_param_allowlist_prefixes.some((prefix) => name.startsWith(prefix))
  );
}

/** Strip credentials, fragments and non-allowlisted query parameters. */
export function sanitizeReferralUrl(url: string | null): string {
  if (!url?.trim()) return '';
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    const kept = [...parsed.searchParams]
      .map(([name, value]) => [name.toLowerCase(), value] as [string, string])
      .filter(([name]) => paramAllowed(name));
    parsed.search = new URLSearchParams(kept).toString();
    return parsed.href;
  } catch {
    return '';
  }
}

/** `unpack_dimension_key`: the declared values, split from the right. */
function unpackDimensionKey(dataset: string, key: string): NonEmpty<string> | null {
  const arity: number | undefined = (referrals.dimension_arity as Record<string, number>)[dataset];
  if (arity === undefined) return null;
  const parts = key.split(referrals.dimension_key_separator);
  if (parts.length < arity) return null;
  const boundary = parts.length - arity + 1;
  return [
    parts.slice(0, boundary).join(referrals.dimension_key_separator),
    ...parts.slice(boundary),
  ];
}

function signalsForRow(row: MetricRowIdentity): Signals | null {
  const values = unpackDimensionKey(row.dataset, row.dimension_key);
  if (values === null) return null;
  const empty = {
    landing_url: '',
    referrer_url: '',
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
  };
  if (row.dataset === referrals.datasets.referrer_daily) {
    // (pageReferrer, date): the full referring URL.
    return { ...empty, referrer_url: values[0].trim() };
  }
  // (sessionSource, sessionMedium, date): the session's traffic-source tags.
  const [source, medium] = values;
  if (medium === undefined) throw new Error(`Expected a session medium on a ${row.dataset} row`);
  return { ...empty, utm_source: source.trim(), utm_medium: medium.trim() };
}

/** The sanitized event fields for one metric row, or null when it maps to no signals. */
export function referralEventFields(row: MetricRowIdentity): ReferralEventFields | null {
  const signals = signalsForRow(row);
  if (signals === null) return null;
  const landingUrl = sanitizeReferralUrl(signals.landing_url);
  const referrerUrl = sanitizeReferralUrl(signals.referrer_url);
  const referrerHost = normalizeDomain(referrerUrl);
  const candidate: Record<string, string> = {
    dataset: row.dataset,
    date: row.date,
    dimension_key: row.dimension_key,
  };
  if (referrerHost) candidate.referrer_host = referrerHost;
  if (signals.utm_source) candidate.utm_source = signals.utm_source;
  if (signals.utm_medium) candidate.utm_medium = signals.utm_medium;
  if (signals.utm_campaign) candidate.utm_campaign = signals.utm_campaign;
  const raw = Object.fromEntries(
    Object.entries(candidate).filter(([key]) => referrals.raw_allowlist.includes(key)),
  );
  // The dedupe key: stable across re-runs because the artifact is immutable.
  const contentHash = createHash('sha256')
    .update(
      JSON.stringify({
        dataset: row.dataset,
        date: row.date,
        dimension_key: row.dimension_key,
        landing_url: landingUrl,
        referrer_url: referrerUrl,
        referrer_host: referrerHost,
        utm_source: signals.utm_source,
        utm_medium: signals.utm_medium,
        utm_campaign: signals.utm_campaign,
      }),
    )
    .digest('hex');
  return {
    landing_url: landingUrl,
    referrer_url: referrerUrl,
    referrer_host: referrerHost,
    utm_source: signals.utm_source,
    utm_medium: signals.utm_medium,
    utm_campaign: signals.utm_campaign,
    user_agent: '',
    session_id_hash: '',
    raw,
    content_hash: contentHash,
  };
}
