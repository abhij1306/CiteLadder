import { ProjectLink } from '@/components/ui/project-link';
import { Badge } from '@/components/ui/badge';
import { Inline } from '@/components/ui/layout';
import { DisplayTime } from '@/components/ui/display-time';
import { groupEvidence, type DatedEvidence } from '@/lib/agent/evidence';

const BASIS_LABEL: Record<DatedEvidence['basis'], string> = {
  observed: 'Observed',
  inferred: 'Inferred',
};

/**
 * The records behind an Action, one chip each: what it is, whether CiteLadder
 * observed it or a rule inferred it, and the date its persisted record carries.
 */
export function DatedEvidenceChips({
  records,
  label,
}: Readonly<{ records: readonly DatedEvidence[]; label: string }>) {
  return (
    <Inline as="ul" aria-label={label} className="flex-wrap">
      {records.map((item) => {
        const chip = (
          <Badge>
            {item.label} · {BASIS_LABEL[item.basis]} ·{' '}
            <DisplayTime value={item.at} dateOnly fallback="date not recorded" />
          </Badge>
        );
        return (
          <li key={item.key} className="min-w-0">
            {item.href ? (
              <ProjectLink href={item.href} className="underline-offset-2 hover:underline">
                {chip}
              </ProjectLink>
            ) : (
              chip
            )}
          </li>
        );
      })}
    </Inline>
  );
}

/**
 * The records a reply or revision cites, grouped by kind. Each group links to
 * the screen that shows that evidence, so a claim can be checked in one click.
 */
export function EvidenceChips({
  refs,
  label = 'Cited evidence',
}: Readonly<{ refs: readonly string[]; label?: string }>) {
  const groups = groupEvidence(refs);
  if (groups.length === 0) return null;
  return (
    <Inline as="ul" aria-label={label} className="flex-wrap">
      {groups.map((group) => {
        const text = group.count > 1 ? `${group.label} · ${group.count}` : group.label;
        return (
          <li key={group.label}>
            {group.href ? (
              <ProjectLink href={group.href} className="underline-offset-2 hover:underline">
                <Badge>{text}</Badge>
              </ProjectLink>
            ) : (
              <Badge>{text}</Badge>
            )}
          </li>
        );
      })}
    </Inline>
  );
}
