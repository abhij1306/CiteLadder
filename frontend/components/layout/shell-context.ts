import { createContext, type ReactNode } from 'react';

export const ShellContext = createContext<Readonly<{
  navDrawer: Readonly<{ open: boolean; onOpen: () => void }>;
  searchTrigger: ReactNode;
  agentTrigger: ReactNode;
}> | null>(null);
