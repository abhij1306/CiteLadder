import { Tag } from '@/components/ui/tag';
import { Absence } from '@/components/ui/absence';
import { pageKindLabel } from '@/lib/site-health/page-kinds';

export function PageKindBadge({
  pageKind,
  className,
}: Readonly<{ pageKind: string | null | undefined; className?: string }>) {
  if (!pageKind) {
    return <Absence state="not_measured" className={className} />;
  }
  return <Tag className={className}>{pageKindLabel(pageKind)}</Tag>;
}
