import type { ReactNode } from 'react';

import { PageFrame, type PageFrameSlots } from './page-frame';

export function WorkbenchPage({
  children,
  ...slots
}: Omit<PageFrameSlots, 'tabs' | 'filters'> & Readonly<{ children: ReactNode }>) {
  return (
    <PageFrame {...slots} fill>
      {children}
    </PageFrame>
  );
}
