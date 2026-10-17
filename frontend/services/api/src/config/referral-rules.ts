type Rule = { rule_id: string };
type UtmRule = Rule & { utm_source: string | null; utm_medium: string | null };

/** Rule IDs persist as provenance; unconstrained UTM rules would match every event. */
export function validateReferralRules(rules: {
  host_rules: Rule[];
  utm_rules: UtmRule[];
  ua_rules: Rule[];
}): void {
  const ids = new Set<string>();
  for (const rule of [...rules.host_rules, ...rules.utm_rules, ...rules.ua_rules]) {
    if (!rule.rule_id || ids.has(rule.rule_id)) throw new Error('Referral rule IDs must be unique');
    ids.add(rule.rule_id);
  }
  if (rules.utm_rules.some((rule) => rule.utm_source === null && rule.utm_medium === null)) {
    throw new Error('Referral UTM rules must constrain a signal');
  }
}
