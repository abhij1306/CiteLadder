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

/**
 * GateNoticeScreen — a whole page that is one gate notice (project setup
 * blocked by a limit or a failed read): the notice centred on the ground,
 * inset by the content gutter, the same inset as `GateScreen`.
 */
export function GateNoticeScreen({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <main
      id="main"
      className="bg-background grid min-h-dvh place-items-center p-[var(--content-gutter)]"
    >
      <GateNoticeFrame title={title}>{children}</GateNoticeFrame>
    </main>
  );
}
