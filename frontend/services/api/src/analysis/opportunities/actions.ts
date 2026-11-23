import {
  actionHandoffSchema,
  type ActionGrouping,
  type ActionHandoff,
  type ActionPriorityBand,
  type ActionTargetKind,
} from '@citeladder/contracts/actions';
import type { IssueFamilyCohort } from '@citeladder/contracts/opportunity-evidence';

import { policy } from '../../config.ts';
import { goalOf } from '../../opportunities/action-groupings.ts';
import { roundScaled } from '../../numbers.ts';
import { compareText } from '../../text-order.ts';
import type { NonEmpty } from '../../lists.ts';
import { actionTargetOf, type ActionTarget } from '../../opportunities/targets/registry.ts';
import type { TargetRef } from './targets.ts';
const p = policy.opportunity.actions;
const MEASUREMENT_LEG_ORDER = [p.LEG_VISIBILITY_RUN, p.LEG_SEARCH_CONSOLE_WINDOW, p.LEG_CRAWL];
export type ActionMember = {
  opportunity_id: string;
  rule_id: string;
  target: TargetRef;
  label_hint: string | null;
  measured_by: string | null;
  title: string;
  priority_score: number;
  source_analysis_ids: string[];
  source_issue_ids: string[];
  source_metric_ids: string[];
  facts: HandoffFacts;
  cohort?: IssueFamilyCohort;
  grouping: ActionGrouping;
};
export type HandoffFacts = Readonly<{ competitors: readonly string[]; angle: string | null }>;
export const NO_HANDOFF_FACTS: HandoffFacts = { competitors: [], angle: null };
type MessageFacts = Readonly<Partial<Record<string, string>>>;
const NAMES = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });
const MAX_URL_DECODE_PASSES = 3;

function readableTarget(label: string): string {
  if (!/^https?:\/\//iu.test(label)) return label;
  let current = label;
  for (let pass = 0; pass < MAX_URL_DECODE_PASSES; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return current;
    }
    if (next === current) return current;
    current = next;
  }
  return current;
}

function handoffMessage(templates: readonly string[], facts: MessageFacts): string {
  for (const template of templates) {
    let complete = true;
    const message = template.replaceAll(/\{(\w+)\}(\.?)/g, (_, name: string, stop: string) => {
      const value = facts[name];
      if (!value) complete = false;
      return (value ?? '') + (value && /[.?!]$/u.test(value) ? '' : stop);
    });
    if (complete) return message;
  }
  return facts.target ?? '';
}
type ApproachBranch = ReturnType<typeof selectApproach>;

function messageFor(branch: Pick<ApproachBranch, 'messages'>, member: ActionMember, label: string) {
  return handoffMessage(branch.messages, {
    target: readableTarget(label),
    issue: member.title,
    angle: member.facts.angle ?? undefined,
    competitors: member.facts.competitors.length
      ? NAMES.format(member.facts.competitors)
      : undefined,
  });
}

function handoffFor(
  approach: ApproachBranch,
  members: NonEmpty<ActionMember>,
  label: string,
): ActionHandoff {
  for (const member of members) {
    const branch = p.APPROACH_TREE.find(
      (candidate) => candidate.handoff && candidate.rule_ids.includes(member.rule_id),
    );
    const handoff = branch?.handoff;
    if (!branch || !handoff) continue;
    const message = messageFor(branch, member, label);
    if (handoff.context === 'opportunity')
      return {
        context: 'opportunity',
        workflow_id: handoff.workflow_id,
        opportunity_id: member.opportunity_id,
        message,
      };
    return { context: 'page_url', workflow_id: handoff.workflow_id, message };
  }
  const rules: readonly string[] = approach.rule_ids;
  const member = members.find((m) => rules.includes(m.rule_id)) ?? members[0];
  return { context: 'action', message: messageFor(approach, member, label) };
}

export function readHandoff(persisted: unknown, label: string): ActionHandoff {
  const parsed = actionHandoffSchema.safeParse(persisted);
  return parsed.success
    ? parsed.data
    : {
        context: 'action',
        message: handoffMessage(p.DEFAULT_APPROACH.messages, { target: readableTarget(label) }),
      };
}
export function priorityBand(score: number | null): ActionPriorityBand | null {
  if (score === null) return null;
  if (score >= p.ACTION_PRIORITY_BANDS.high) return 'high';
  return score >= p.ACTION_PRIORITY_BANDS.medium ? 'medium' : 'low';
}

function selectApproach(ids: string[], kind: ActionTargetKind) {
  return (
    p.APPROACH_TREE.find(
      (b) =>
        (!b.target_kinds.length || b.target_kinds.includes(kind)) &&
        b.rule_ids.some((r) => ids.includes(r)),
    ) ?? p.DEFAULT_APPROACH
  );
}
function group(t: ActionTarget, members: NonEmpty<ActionMember>) {
  const ordered: [ActionMember, ...ActionMember[]] = [...members];
  ordered.sort(
    (a, b) =>
      b.priority_score - a.priority_score ||
      compareText(a.rule_id, b.rule_id) ||
      compareText(a.opportunity_id, b.opportunity_id),
  );
  const familyMap: Record<string, string> = p.RULE_EVIDENCE_FAMILY;
  const families = p.EVIDENCE_FAMILIES.filter((f) =>
    ordered.some((m) => familyMap[m.rule_id] === f),
  );
  const legs = MEASUREMENT_LEG_ORDER.filter((leg) => ordered.some((m) => m.measured_by === leg));
  const branch = selectApproach(
    ordered.map((m) => m.rule_id),
    t.kind,
  );
  return {
    target: t,
    members: ordered,
    cohort: ordered.find((m) => m.cohort)?.cohort ?? null,
    goal: goalOf(ordered[0].grouping),
    grouping: ordered[0].grouping,
    families,
    priority_score: roundScaled(ordered[0].priority_score, p.ACTION_PRIORITY_ROUNDING_DECIMALS),
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
      approach: branch.approach,
      skill_id: branch.skill_id,
      donts: [...branch.donts],
      measure_with: legs,
      handoff: handoffFor(branch, ordered, t.label),
      versions: {
        grouping: p.ACTION_GROUPING_VERSION,
        diagnosis: p.ACTION_DIAGNOSIS_VERSION,
        priority: p.ACTION_PRIORITY_VERSION,
      },
    },
  };
}
export function groupMembers(members: ActionMember[]) {
  const groups = new Map<
    string,
    { target: ActionTarget; members: [ActionMember, ...ActionMember[]] }
  >();
  for (const member of members) {
    const t = actionTargetOf(member);
    const entry = groups.get(t.group_key);
    if (entry) entry.members.push(member);
    else groups.set(t.group_key, { target: t, members: [member] });
  }
  return [...groups.values()]
    .map((g) => group(g.target, g.members))
    .sort(
      (a, b) =>
        b.priority_score - a.priority_score || compareText(a.target.group_key, b.target.group_key),
    );
}
