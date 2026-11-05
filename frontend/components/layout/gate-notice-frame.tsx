import type { ReactNode } from 'react';

import { Callout } from '@/components/ui/callout';
import { textRole } from '@/components/ui/typography';

/** Common warning content for project-route gates. */
export function GateNoticeFrame({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <Callout tone="warning" className="max-w-lg">
      <div className="grid gap-4">
        <h1 className={textRole('sectionTitle')}>{title}</h1>
        {children}
      </div>
    </Callout>
  );
}
