import { createContext, type ReactNode } from 'react';

/**
 * What the signed-in shell hands every page header. Null outside the shell,
 * where there is no navigation to open and no Agent to ask.
 */
export const ShellContext = createContext<Readonly<{
  /** The navigation drawer, opened by the header's menu button below 900px (owner, 2026-11-06). */
  navDrawer: Readonly<{ open: boolean; onOpen: () => void }>;
  /** The header's Agent trigger; the shell owns the Agent panel it opens. */
  agentTrigger: ReactNode;
}> | null>(null);
