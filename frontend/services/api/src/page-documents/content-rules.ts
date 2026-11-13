/**
 * The content rule catalog at work (docs/plans/content-rules-engine.md): its
 * fingerprint, which of its model rules a turn's evidence makes eligible, the
 * `content_rules` context section that offers them to the model, and the
 * category, source and strength a suggestion stores for its rule. Deterministic
 * and pure: eligibility reads only the turn's persisted context manifest.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Json } from '../agent/contracts.ts';
import type { Manifest } from '../agent/context.ts';
import { policy } from '../config.ts';
import { ruleTitle } from '../site-health/reads/rules.ts';
import type { ContentRule } from '../config/content-rules.ts';

const c = policy.content_rules;
type Evidence = (typeof c.evidence)[number];
type ModelRule = Extract<ContentRule, { layer: 'L4' }>;

/** The catalog's version: a fingerprint of its content, like the skill catalog's. */
export const contentRulesVersion = `content-rules-${createHash('sha256')
  .update(JSON.stringify(c))
  .digest('hex')
  .slice(0, 16)}`;

const BY_ID: ReadonlyMap<string, ContentRule> = new Map(c.rules.map((rule) => [rule.id, rule]));
const MODEL_RULES = c.rules.filter((rule): rule is ModelRule => rule.layer === 'L4');
const SITE_HEALTH_IDS = c.rules.filter((rule) => rule.layer === 'L0').map((rule) => rule.id);
const GAP = policy.opportunity.opportunities.CONTENT_GAP;
const GAP_RULES: ReadonlySet<string> = new Set([GAP.RULE_IMPROVE_PAGE, GAP.RULE_NEW_PAGE]);

/** Whether a rule id is a Site Health rule (L0) the model pass never raises. */
export function isSiteHealthRule(ruleId: string) {
  return BY_ID.get(ruleId)?.layer === 'L0';
}

const fetchedSchema = z.object({
  outcome: z.literal('fetched'),
  page_kind: z.string().nullish(),
  /** The page-local Site Health checks that failed on the fetched page (`fetchedPageContext`). */
  failing_checks: z
    .array(z.object({ rule_id: z.string(), outcome: z.string(), reason_code: z.string() }).loose())
    .default([]),
});
const promptsSchema = z.object({ prompts: z.array(z.string()).min(1) });
const diagnosisSchema = z.object({
  what_happened: z.array(z.object({ rule_id: z.string() }).loose()),
});

/** The context a turn's rules are judged from: its persisted manifest's sections and Action. */
type TurnContext = {
  sections: Manifest['package']['sections'];
  action: Manifest['action'];
};

type FailingCheck = z.infer<typeof fetchedSchema>['failing_checks'][number];

/**
 * The evidence present for a turn, the page's Site Health kind when the fetch
 * knows it, and the catalog's Site Health rules failing on the fetched page.
 */
function turnEvidence(turn: TurnContext) {
  const fetched = fetchedSchema.safeParse(turn.sections.fetched_page);
  const present = new Set<Evidence>();
  if (!fetched.success) return { present, pageKind: null, findings: [] };
  present.add('fetched_page');
  const pageKind = fetched.data.page_kind ?? null;
  if (pageKind) present.add('page_kind');
  const gap = diagnosisSchema
    .safeParse(turn.action?.diagnosis)
    .data?.what_happened.some((item) => GAP_RULES.has(item.rule_id));
  if (gap || promptsSchema.safeParse(turn.sections.target_prompts).success)
    present.add('page_prompts');
  const findings = fetched.data.failing_checks.filter((check) => isSiteHealthRule(check.rule_id));
  return { present, pageKind, findings };
}

/**
 * A turn's rules: the model rules whose evidence is all present and whose
 * page types include the page (`offered`), those left out for missing
 * evidence (`notChecked`, never guessed), and the Site Health rules failing on
 * the fetched page, whose fix the model may write (`findings`). Null for a
 * turn without a fetched page.
 */
function turnRules(turn: TurnContext) {
  const { present, pageKind, findings } = turnEvidence(turn);
  if (!present.has('fetched_page')) return null;
  const offered: ModelRule[] = [];
  const notChecked: { rule_id: string; missing: Evidence[] }[] = [];
  for (const rule of MODEL_RULES) {
    const missing = rule.requires.filter((evidence) => !present.has(evidence));
    if (missing.length) notChecked.push({ rule_id: rule.id, missing });
    else if (rule.page_types === 'any' || (pageKind && rule.page_types.includes(pageKind)))
      offered.push(rule);
  }
  return { offered, notChecked, findings };
}

/**
 * The rule ids a turn's suggestions may name: the model rules it offers and
 * the Site Health rules failing on the fetched page. Empty for a turn without
 * a fetched page.
 */
export function offeredRuleIds(turn: TurnContext): ReadonlySet<string> {
  const rules = turnRules(turn);
  if (!rules) return new Set();
  return new Set([
    ...rules.offered.map((rule) => rule.id),
    ...rules.findings.map((check) => check.rule_id),
  ]);
}

/** A Site Health finding the model may write the fix for: the rule, its title and what was found. */
function findingLine(check: FailingCheck) {
  return `${check.rule_id}: ${ruleTitle(check.rule_id)} (${check.outcome}, ${check.reason_code})`;
}

/**
 * One offered rule as the model reads it, one line to keep the context small:
 * `rule_id [category, strength, severity]: what it checks. Thresholds. Guidance.`
 */
function ruleLine(rule: ModelRule) {
  const thresholds = Object.entries(rule.thresholds ?? {}).map(
    ([name, value]) => `${name.replaceAll('_', ' ')}: ${value}.`,
  );
  return [
    `${rule.id} [${rule.category}, ${rule.strength}, ${rule.severity}]: ${rule.checks}`,
    ...thresholds,
    rule.guidance ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The `content_rules` section for a page turn: the rules it offers, how each
 * strength is phrased, the Site Health rules it never raises, and the rules
 * not checked for missing evidence. Null for any other turn.
 */
function contentRulesSection(turn: TurnContext): Record<string, Json> | null {
  const rules = turnRules(turn);
  if (!rules) return null;
  return {
    catalog_version: contentRulesVersion,
    rules: rules.offered.map(ruleLine),
    phrasing: { ...c.phrasing },
    limits: c.limits,
    // Failing on this page: the model may write their fix, under the same rule_id.
    site_health_findings: rules.findings.map(findingLine),
    // Never raised by the model; only a finding above takes its fix.
    site_health_rules: SITE_HEALTH_IDS,
    not_checked: rules.notChecked.map(
      ({ rule_id, missing }) => `${rule_id} (needs ${missing.join(', ')})`,
    ),
  };
}

/**
 * The context package with the `content_rules` section first, so trimming an
 * oversized context drops it last; unchanged for a turn without a fetched page.
 */
export function withContentRules(
  pkg: Manifest['package'],
  action: Manifest['action'],
): Manifest['package'] {
  const section = contentRulesSection({ sections: pkg.sections, action });
  return section ? { ...pkg, sections: { content_rules: section, ...pkg.sections } } : pkg;
}

/**
 * What a suggestion stores for its rule: the rule's category, and its source
 * and strength with the catalog version they were read from. The caller has
 * checked the rule is in the catalog.
 */
export function ruleGuidance(ruleId: string) {
  const rule = BY_ID.get(ruleId);
  if (!rule) throw new TypeError(`Rule ${ruleId} is not in the content rule catalog`);
  const source = c.sources[rule.source];
  return {
    category: rule.category,
    guidance: {
      catalog_version: contentRulesVersion,
      strength: rule.strength,
      source_key: rule.source,
      source_label: source.label,
      source_url: source.url,
    },
  };
}
