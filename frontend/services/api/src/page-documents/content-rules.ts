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

export const contentRulesVersion = `content-rules-${createHash('sha256')
  .update(JSON.stringify(c))
  .digest('hex')
  .slice(0, 16)}`;

const BY_ID: ReadonlyMap<string, ContentRule> = new Map(c.rules.map((rule) => [rule.id, rule]));
const MODEL_RULES = c.rules.filter((rule): rule is ModelRule => rule.layer === 'L4');
const SITE_HEALTH_IDS = c.rules.filter((rule) => rule.layer === 'L0').map((rule) => rule.id);
const GAP = policy.opportunity.opportunities.CONTENT_GAP;
const GAP_RULES: ReadonlySet<string> = new Set([GAP.RULE_IMPROVE_PAGE, GAP.RULE_NEW_PAGE]);

export function isSiteHealthRule(ruleId: string) {
  return BY_ID.get(ruleId)?.layer === 'L0';
}

const fetchedSchema = z.object({
  outcome: z.literal('fetched'),
  page_kind: z.string().nullish(),
  failing_checks: z
    .array(z.object({ rule_id: z.string(), outcome: z.string(), reason_code: z.string() }).loose())
    .default([]),
});
const promptsSchema = z.object({ prompts: z.array(z.string()).min(1) });
const diagnosisSchema = z.object({
  what_happened: z.array(z.object({ rule_id: z.string() }).loose()),
});

type TurnContext = {
  sections: Manifest['package']['sections'];
  action: Manifest['action'];
};

type FailingCheck = z.infer<typeof fetchedSchema>['failing_checks'][number];

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

export function offeredRuleIds(turn: TurnContext): ReadonlySet<string> {
  const rules = turnRules(turn);
  if (!rules) return new Set();
  return new Set([
    ...rules.offered.map((rule) => rule.id),
    ...rules.findings.map((check) => check.rule_id),
  ]);
}

function findingLine(check: FailingCheck) {
  return `${check.rule_id}: ${ruleTitle(check.rule_id)} (${check.outcome}, ${check.reason_code})`;
}

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

function contentRulesSection(turn: TurnContext): Record<string, Json> | null {
  const rules = turnRules(turn);
  if (!rules) return null;
  return {
    catalog_version: contentRulesVersion,
    rules: rules.offered.map(ruleLine),
    phrasing: { ...c.phrasing },
    limits: c.limits,
    site_health_findings: rules.findings.map(findingLine),
    site_health_rules: SITE_HEALTH_IDS,
    not_checked: rules.notChecked.map(
      ({ rule_id, missing }) => `${rule_id} (needs ${missing.join(', ')})`,
    ),
  };
}

export function withContentRules(
  pkg: Manifest['package'],
  action: Manifest['action'],
): Manifest['package'] {
  const section = contentRulesSection({ sections: pkg.sections, action });
  return section ? { ...pkg, sections: { content_rules: section, ...pkg.sections } } : pkg;
}

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
