import { Badge } from '@/components/ui/badge';
import type { OpportunityType } from '@/lib/api/types';

const TYPE_LABEL: Record<OpportunityType, string> = {
  visibility: 'Visibility',
  commerce: 'Commerce',
  site: 'Site',
  traffic: 'Traffic',
  topic: 'Topic',
};

export function OpportunityTypeBadge({ type }: Readonly<{ type: OpportunityType }>) {
  return <Badge>{TYPE_LABEL[type]}</Badge>;
}
