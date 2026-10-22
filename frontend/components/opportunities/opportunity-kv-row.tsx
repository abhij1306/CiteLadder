import { Inline } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';

export function OpportunityKvRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <Inline gap="compact" className="items-start justify-between">
      <span className="type-caption shrink-0">{label}</span>
      <span className={textRole('body', 'text-right break-words')}>{value}</span>
    </Inline>
  );
}
