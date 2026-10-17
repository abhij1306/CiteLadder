import { createContext, type Dispatch, type SetStateAction } from 'react';

/**
 * Lets a route-owned PageShell supply the compact shell's label when its
 * heading is intentionally visually hidden at narrow widths.
 */
export const CompactPageTitleContext = createContext<Dispatch<
  SetStateAction<string | undefined>
> | null>(null);
