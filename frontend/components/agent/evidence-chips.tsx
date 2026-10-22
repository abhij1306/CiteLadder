import { ProjectLink } from '@/components/layout/scoped-link';
import { Badge } from '@/components/ui/badge';
import { badgeLinkClasses } from '@/components/ui/badge-variants';
import { Inline } from '@/components/ui/layout';
import { groupEvidence } from '@/lib/agent/evidence';

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
              <ProjectLink href={group.href} className={badgeLinkClasses}>
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
