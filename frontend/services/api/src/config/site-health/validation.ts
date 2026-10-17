/** Cross-field constraints not expressible in an individual environment spec. */
export function validateSiteHealthSettings(values: Record<string, unknown>) {
  const number = (key: string) => Number(values[key]);
  const atMost = (smaller: string, larger: string) => {
    if (number(smaller) > number(larger))
      throw new Error(`Site Health ${smaller} must not exceed ${larger}`);
  };
  for (const [smaller, larger] of [
    ['automatic_page_limit', 'max_requested_page_limit'],
    ['max_requested_page_limit', 'max_discovery_urls'],
    ['max_advanced_requested_page_limit', 'max_discovery_urls'],
    ['sample_url_limit', 'sample_discovery_url_cap'],
    ['analysis_dependency_retry_seconds', 'analysis_dependency_retry_max_seconds'],
    ['per_host_concurrency', 'global_concurrency'],
  ] as const)
    atMost(smaller, larger);
  const lease = number('lease_ttl_seconds');
  if (number('heartbeat_interval_seconds') >= lease)
    throw new Error(
      'Site Health heartbeat_interval_seconds must be shorter than lease_ttl_seconds',
    );
  const stalled = number('stalled_crawl_reconcile_seconds');
  if (stalled > 0 && stalled <= lease)
    throw new Error(
      'Site Health stalled_crawl_reconcile_seconds must exceed lease_ttl_seconds or be 0',
    );
  if (!String(values.acquisition_policy_version).trim())
    throw new Error('Site Health acquisition_policy_version must not be empty');
}

type Rule = {
  rule_id: string;
  finding_class: string;
  score_roles: readonly string[];
  kind_evidence: string;
  scope: string;
  triggered_by: string;
  composite_contract: { threshold: string; atoms: { name: string; condition: string }[] } | null;
};

function validateComposite(rule: Rule) {
  const contract = rule.composite_contract;
  if (!contract) return;
  const names = contract.atoms.map((atom) => atom.name.trim());
  if (
    !names.length ||
    names.some((name) => !name) ||
    new Set(names).size !== names.length ||
    !['all_required', 'all_required_and_applicable'].includes(contract.threshold) ||
    contract.atoms.some(
      (atom) => atom.condition && !/^(?:not_)?page_trait:.+$/u.test(atom.condition),
    )
  )
    throw new Error(`Invalid composite contract: ${rule.rule_id}`);
}

function validateRule(rule: Rule, byId: Map<string, Rule>) {
  if (
    !['defect', 'advisory', 'diagnostic'].includes(rule.finding_class) ||
    !['expectation', 'triggered'].includes(rule.kind_evidence) ||
    !['page', 'site', 'cluster', 'graph'].includes(rule.scope)
  )
    throw new Error(`Invalid Site Health rule policy: ${rule.rule_id}`);
  if (
    rule.kind_evidence === 'triggered' &&
    byId.get(rule.triggered_by)?.kind_evidence !== 'expectation'
  )
    throw new Error(`Triggered rule ${rule.rule_id} requires an expectation sibling`);
  validateComposite(rule);
}

/** Catalog relationships must remain valid when a config author changes a check. */
export function validateSiteHealthCatalog(
  rules: readonly Rule[],
  weights: Record<string, number>,
  pillars: Record<string, string>,
  contentFields: Record<string, string>,
) {
  const byId = new Map(rules.map((rule) => [rule.rule_id, rule]));
  if (byId.size !== rules.length) throw new Error('Duplicate Site Health rule ID');
  for (const rule of rules) validateRule(rule, byId);
  if (
    Object.values(weights).some((weight) => !Number.isFinite(weight) || weight <= 0) ||
    Math.abs(Object.values(weights).reduce((sum, weight) => sum + weight, 0) - 1) > 1e-9
  )
    throw new Error('Readiness pillar weights must be positive and sum to one');
  const covered = new Set(Object.values(pillars));
  if (
    Object.keys(weights).some((pillar) => !covered.has(pillar)) ||
    [...covered].some((pillar) => !(pillar in weights))
  )
    throw new Error('Every readiness pillar requires a configured check');
  for (const id of [...Object.keys(pillars), ...Object.keys(contentFields)])
    if (!byId.has(id)) throw new Error(`Public checklist names an unknown rule: ${id}`);
  validateScoreMembership(rules, pillars);
}

/**
 * `score_roles` is the one source of score membership. An AEO-scored rule needs
 * exactly one pillar, and a scored rule must surface as an issue: no check may
 * move a score without a visible finding.
 */
function validateScoreMembership(rules: readonly Rule[], pillars: Record<string, string>) {
  for (const rule of rules) {
    const roles = new Set(rule.score_roles);
    if ([...roles].some((role) => role !== 'web_fundamentals' && role !== 'aeo_readiness'))
      throw new Error(`Unknown score role on ${rule.rule_id}`);
    if (roles.has('aeo_readiness') !== Boolean(pillars[rule.rule_id]))
      throw new Error(`AEO membership and pillar disagree for ${rule.rule_id}`);
    if (roles.size && rule.finding_class === 'diagnostic')
      throw new Error(`Scored rule ${rule.rule_id} must create a visible finding`);
  }
}
