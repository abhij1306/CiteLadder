import { RecordTag, Tag } from '@/components/ui/tag';
import { Inline } from '@/components/ui/layout';
import { groupEvidence } from '@/lib/agent/evidence';

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
            {group.href ? <RecordTag href={group.href} label={text} /> : <Tag>{text}</Tag>}
          </li>
        );
      })}
    </Inline>
  );
}
