import { createContext, useContext, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { isFlowPath } from '@/lib/navigation/app-routes';

import { ShellFallback } from './shell-fallback';

export function FirstFrame({ children }: Readonly<{ children?: ReactNode }>) {
  const { pathname } = useLocation();
  if (!isFlowPath(pathname ?? '')) return <ShellFallback>{children}</ShellFallback>;
  return (
    <div data-flow-frame="" className="bg-ground text-ink min-h-dvh antialiased">
      {children === undefined ? null : (
        <main
          id="main"
          className="max-w-flow mx-auto w-full px-[var(--content-gutter)] pt-[var(--flow-gap)]"
        >
          {children}
        </main>
      )}
    </div>
  );
}

const GateHoldContext = createContext(false);

export function GateHold({ held, children }: Readonly<{ held: boolean; children: ReactNode }>) {
  const outer = useContext(GateHoldContext);
  return <GateHoldContext.Provider value={outer || held}>{children}</GateHoldContext.Provider>;
}

export function HeldContent({
  frame,
  children,
}: Readonly<{ frame: ReactNode; children: ReactNode }>) {
  return useContext(GateHoldContext) ? frame : children;
}
