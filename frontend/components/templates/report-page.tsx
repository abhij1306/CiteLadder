import type { ReactNode } from 'react';

import { PageFrame, PageSections, type PageFrameSlots } from './page-frame';

export function ReportPage({
  children,
  ...slots
}: PageFrameSlots & Readonly<{ children: ReactNode }>) {
  return (
    <PageFrame {...slots}>
      <PageSections>{children}</PageSections>
    </PageFrame>
  );
}
