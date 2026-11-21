import { Inline } from '@/components/ui/layout';
import { Spinner } from '@/components/ui/spinner';
import { AUDIT_STATES } from '@/lib/runs/status';
import type { ActiveRun } from '@/lib/visibility/dashboard';
import { TextLink } from '@/components/ui/text-link';
import { Notice } from '@/components/ui/notice';

export function ActiveRunBanner({ run }: Readonly<{ run: ActiveRun }>) {
  return (
    <Notice tone="info">
      <Inline className="flex-wrap">
        <Spinner />
        <span>A run is in progress ({AUDIT_STATES[run.status].label}).</span>
        <TextLink text="emphasis" className="whitespace-nowrap" href={`/runs/${run.id}`}>
          Watch live progress →
        </TextLink>
      </Inline>
    </Notice>
  );
}
