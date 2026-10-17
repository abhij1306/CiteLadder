import { policy } from '../../config.ts';
import { round } from '../../demand/projection.ts';
import { normalizedUrlForCompare } from '../url-compare.ts';
import { rules } from './detectors.ts';
import { compareText } from '../../text-order.ts';
import type { NonEmpty } from '../../lists.ts';
const p = policy.opportunity.actions;
export type ActionMember = {
  opportunity_id: string;
  rule_id: string;
  target_key: string;
  target_url: string | null;
  target_prompt_id: string | null;
  target_theme: string | null;
  label_hint: string | null;
  title: string;
  priority_score: number;
  source_analysis_ids: string[];
  source_issue_ids: string[];
  source_metric_ids: string[];
};
export const pageGroupKey = (url: string) => `page:${normalizedUrlForCompare(url)}`;
/** One planned page per topic, whether the Agent or evidence names it first; null without one. */
export function plannedPageKey(topic: string): string | null {
  // Letters in any script, so a keyword in Hindi or Japanese still names a page.
  const slug = topic
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-|-$/gu, '');
  return slug ? `planned:${[...slug].slice(0, p.PLANNED_PAGE_TOPIC_MAX_CHARS).join('')}` : null;
}
function target(
  key: string,
  kind: string,
  member: ActionMember,
  url: string | null = null,
  prompt: string | null = null,
) {
  return {
    group_key: key,
    kind,
    label: [...(url || member.label_hint || member.target_theme || member.title)]
      .slice(0, p.ACTION_LABEL_MAX_CHARS)
      .join(''),
    url,
    prompt_id: prompt,
  };
}
export function targetFor(member: ActionMember) {
  const key = member.target_key;
  if (rules[member.rule_id]!.action_path === policy.opportunity.earned_actions.ACTION_PATH_EARNED)
    return target(`earned:${key}`, p.TARGET_EARNED_PAGE, member, member.target_url);
  if (key.startsWith('product:')) return target(key, p.TARGET_PRODUCT, member);
  if (key.startsWith('category:')) return target(key, p.TARGET_CATEGORY, member);
  if (member.target_url)
    return target(pageGroupKey(member.target_url), p.TARGET_PAGE, member, member.target_url);
  if (member.target_prompt_id !== null)
    return target(
      `prompt:${member.target_prompt_id}`,
      p.TARGET_PROMPT,
      member,
      null,
      member.target_prompt_id,
    );
  if (key.startsWith('prompt')) return target(key, p.TARGET_PROMPT, member);
  // A keyword gap no existing page covers is a page to create.
  const planned = key.startsWith('search-gap:') ? plannedPageKey(member.target_theme ?? '') : null;
  if (planned) return target(planned, p.TARGET_PLANNED_PAGE, member);
  if (key.startsWith('demand:') && member.target_theme)
    return target(`query:${member.target_theme.toLowerCase().trim()}`, p.TARGET_QUERY, member);
  return target(key, p.TARGET_QUERY, member);
}
function actionPriority(strongest: number, families: number): number {
  return round(
    strongest *
      Math.min(
        p.CONVERGENCE_MULTIPLIER_CAP,
        1 + p.CONVERGENCE_BONUS_PER_FAMILY * Math.max(families - 1, 0),
      ),
    p.ACTION_PRIORITY_ROUNDING_DECIMALS,
  );
}
export function selectApproach(ids: string[], kind: string) {
  return (
    p.APPROACH_TREE.find(
      (b) =>
        (!b.target_kinds.length || b.target_kinds.includes(kind)) &&
        b.rule_ids.some((r) => ids.includes(r)),
    ) ?? p.DEFAULT_APPROACH
  );
}
function familyState(family: string, observed: string[], available: string[]) {
  if (observed.includes(family)) return p.FAMILY_STATE_OBSERVED;
  return available.includes(family) ? p.FAMILY_STATE_NO_FINDING : p.FAMILY_STATE_UNAVAILABLE;
}
function group(
  t: ReturnType<typeof targetFor>,
  members: NonEmpty<ActionMember>,
  available: string[],
) {
  const ordered: [ActionMember, ...ActionMember[]] = [...members];
  ordered.sort(
    (a, b) =>
      b.priority_score - a.priority_score ||
      compareText(a.rule_id, b.rule_id) ||
      compareText(a.opportunity_id, b.opportunity_id),
  );
  const familyMap: Record<string, string> = p.RULE_EVIDENCE_FAMILY;
  const legMap: Record<string, string> = p.FAMILY_MEASUREMENT_LEG;
  const families = p.EVIDENCE_FAMILIES.filter((f) =>
    ordered.some((m) => familyMap[m.rule_id] === f),
  );
  const branch = selectApproach(
    ordered.map((m) => m.rule_id),
    t.kind,
  );
  return {
    target: t,
    members: ordered,
    families,
    priority_score: actionPriority(ordered[0].priority_score, families.length),
    approach: branch.approach,
    skill_id: branch.skill_id,
    diagnosis: {
      what_happened: ordered.map((m) => ({
        opportunity_id: m.opportunity_id,
        rule_id: m.rule_id,
        title: m.title,
        family: familyMap[m.rule_id],
        priority_score: m.priority_score,
        source_analysis_ids: [...m.source_analysis_ids],
        source_issue_ids: [...m.source_issue_ids],
        source_metric_ids: [...m.source_metric_ids],
      })),
      families: Object.fromEntries(
        p.EVIDENCE_FAMILIES.map((f) => [f, familyState(f, families, available)]),
      ),
      approach: branch.approach,
      skill_id: branch.skill_id,
      donts: [...branch.donts],
      measure_with: [...new Set(families.map((f) => legMap[f]))],
      versions: {
        grouping: p.ACTION_GROUPING_VERSION,
        diagnosis: p.ACTION_DIAGNOSIS_VERSION,
        priority: p.ACTION_PRIORITY_VERSION,
      },
    },
  };
}
export function groupMembers(members: ActionMember[], available: string[]) {
  const groups = new Map<
    string,
    { target: ReturnType<typeof targetFor>; members: [ActionMember, ...ActionMember[]] }
  >();
  for (const member of members) {
    const t = targetFor(member);
    const entry = groups.get(t.group_key);
    if (entry) entry.members.push(member);
    else groups.set(t.group_key, { target: t, members: [member] });
  }
  return [...groups.values()]
    .map((g) => group(g.target, g.members, available))
    .sort(
      (a, b) =>
        b.priority_score - a.priority_score || compareText(a.target.group_key, b.target.group_key),
    );
}
