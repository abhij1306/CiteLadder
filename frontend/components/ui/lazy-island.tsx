'use client';

import { Component, Suspense, type ReactNode } from 'react';

import { textRole } from '@/components/ui/typography';

type BoundaryProps = Readonly<{ failed: ReactNode; children: ReactNode }>;

/**
 * Catches a lazy piece that cannot load (a chunk that failed to download,
 * typically after a deploy replaced it) so the failure stays inside the space
 * the piece was given. Without it the rejection travels to the screen's
 * error boundary and a missing navigation count or chart replaces the whole
 * screen. It does not retry: React keeps a failed lazy import failed, and a
 * reload is the honest way back.
 */
class IslandBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.failed : this.props.children;
  }
}

/**
 * A lazily loaded piece inside space its parent already holds: `loading`
 * while its code downloads, `failed` in the same place if it cannot load.
 */
export function LazyIsland({
  loading = null,
  failed,
  children,
}: Readonly<{ loading?: ReactNode; failed: ReactNode; children: ReactNode }>) {
  return (
    <IslandBoundary failed={failed}>
      <Suspense fallback={loading}>{children}</Suspense>
    </IslandBoundary>
  );
}

/** The quiet stand-in for a piece that could not load, centred in its box. */
export function IslandUnavailable({ message }: Readonly<{ message: string }>) {
  return (
    <div className="grid h-full place-items-center">
      <p className={textRole('caption', 'text-muted')}>{message}</p>
    </div>
  );
}
