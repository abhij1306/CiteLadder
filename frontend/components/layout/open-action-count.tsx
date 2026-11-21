import { Tooltip } from '@/components/ui/tooltip';
import { queueCount, useActionStatusCounts } from '@/lib/agent/use-action-status-counts';
import { formatCount, pluralCount } from '@/lib/format';

type OpenActions =
  | { kind: 'pending' }
  | { kind: 'unknown' }
  | { kind: 'counted'; count: number; label: string };

function useOpenActions(): OpenActions {
  const { counts, pending } = useActionStatusCounts();
  if (!counts) return { kind: pending ? 'pending' : 'unknown' };
  const count = queueCount(counts);
  return { kind: 'counted', count, label: pluralCount(count, 'open Action') };
}

export function OpenActionCount() {
  const open = useOpenActions();
  switch (open.kind) {
    case 'pending':
      return <span aria-hidden className="bg-well rounded-control inline-block h-3 w-[3ch]" />;
    case 'unknown':
      return null;
    case 'counted':
      return (
        <Tooltip content={open.label} side="right" describe={false}>
          <span>
            <span aria-hidden>{formatCount(open.count)}</span>
            <span className="sr-only">, {open.label}</span>
          </span>
        </Tooltip>
      );
    default: {
      const unreachable: never = open;
      return unreachable;
    }
  }
}

export function OpenActionCountLabel() {
  const open = useOpenActions();
  return open.kind === 'counted' ? <>, {open.label}</> : null;
}
