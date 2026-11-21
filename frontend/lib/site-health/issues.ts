import type { IssueSeverity, IssueDimension } from '@citeladder/contracts';
import type { PriorityValue } from '@/components/ui/status-mark';

/**
 * A ranked action's severity read as its priority (High, Medium, Low): the
 * priority badge's accent-or-neutral scale, never the error red, which stays
 * with Site Health's own issue severities (owner, 2026-11-06).
 */
export function severityPriority(severity: IssueSeverity): PriorityValue {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    default:
      return 'low';
  }
}

const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  critical: 'High',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

export function severityLabel(severity: IssueSeverity): string {
  return SEVERITY_LABEL[severity];
}

const SEVERITY_RANK: Record<IssueSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function severityRank(severity: IssueSeverity): number {
  return SEVERITY_RANK[severity] ?? 99;
}

const SCORE_ROLE_LABEL: Readonly<Record<string, string>> = {
  web_fundamentals: 'Web fundamentals',
  aeo_readiness: 'AEO readiness',
};

export function scoreRoleLabels(roles: readonly string[]): string[] {
  return roles.map((role) => SCORE_ROLE_LABEL[role] ?? role);
}

export function dimensionLabel(dimension: IssueDimension): string {
  return dimension === 'aeo' ? 'AEO' : 'Web fundamentals';
}

export function issueTitle(issue: { title: string; rule_id: string }): string {
  const title = issue.title.trim();
  return title.length > 0 ? title : issue.rule_id;
}

export function sentences(text: string): string[] {
  const source = text.trim();
  const found: string[] = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const next = source[index + 1] ?? ' ';
    if ('.!?'.includes(source[index] ?? '') && next.trim() === '') {
      found.push(source.slice(start, index + 1).trim());
      start = index + 1;
    }
  }
  found.push(source.slice(start).trim());
  return found.filter(Boolean);
}

export function firstSentence(text: string): string {
  return sentences(text)[0] ?? text.trim();
}

export function severityCount(counts: Record<string, number>, severity: IssueSeverity): number {
  if (severity === 'high') {
    return (counts.high ?? 0) + (counts.critical ?? 0);
  }
  return counts[severity] ?? 0;
}
