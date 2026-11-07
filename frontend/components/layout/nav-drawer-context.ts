import { createContext } from 'react';

/**
 * The shell's navigation drawer, for the page header's menu button below
 * 900px (owner, 2026-11-06). Null outside the signed-in shell, where there
 * is no navigation to open.
 */
export const NavDrawerContext = createContext<Readonly<{
  open: boolean;
  onOpen: () => void;
}> | null>(null);
