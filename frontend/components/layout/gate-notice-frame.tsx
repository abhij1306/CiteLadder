import type { ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { textRole } from '@/components/ui/typography';

/** Common warning content for project-route and project-setup gates. */
export function GateNoticeFrame({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <Alert tone="warning" className="max-w-lg">
      <div className="grid gap-4">
        <h1 className={textRole('sectionTitle')}>{title}</h1>
        {children}
      </div>
    </Alert>
  );
}
