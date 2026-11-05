'use client';

import { Component, Suspense, type ReactNode } from 'react';

import { textRole } from '@/components/ui/typography';
import { isChunkLoadError, reportClientError } from '@/lib/client-errors';

/**
 * What an island does with an error that is not a failed download, a defect
 * in the piece itself. `surface` hands it to the screen's error boundary, so a
 * chart handed data of the wrong shape shows as a broken screen instead of
 * hiding behind "Couldn't load". `contain` shows `failed` in place, for chrome
 * such as a navigation count that must never take the shell down with it.
 */
type DefectHandling = 'surface' | 'contain';

type BoundaryProps = Readonly<{
  failed: ReactNode;
  label: string;
  defects: DefectHandling;
  children: ReactNode;
}>;

/**
 * Catches a lazy piece that cannot load (a chunk that failed to download,
 * typically after a deploy replaced it) so the failure stays inside the space
 * the piece was given. Without it the rejection travels to the screen's
 * error boundary and a missing navigation count or chart replaces the whole
 * screen. It does not retry: React keeps a failed lazy import failed, and a
 * reload is the honest way back. Other errors follow `defects`; every error is
 * reported.
 */
class IslandBoundary extends Component<BoundaryProps, { error: { thrown: unknown } | null }> {
  override state: { error: { thrown: unknown } | null } = { error: null };

  static getDerivedStateFromError(thrown: unknown): { error: { thrown: unknown } } {
    return { error: { thrown } };
  }

  override componentDidCatch(error: unknown) {
    const chunk = isChunkLoadError(error);
    reportClientError({
      kind: chunk ? 'chunk_load' : 'render',
      error,
      component: this.props.label,
    });
    if (chunk || this.props.defects === 'contain') return;
    // An update that throws hands the original error to the nearest boundary above.
    this.setState(() => {
      throw error;
    });
  }

  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (this.props.defects === 'contain' || isChunkLoadError(error.thrown))
      return this.props.failed;
    // A surfaced defect renders nothing for the moment before it is handed upward.
    return null;
  }
}

/**
 * A lazily loaded piece inside space its parent already holds: `loading`
 * while its code downloads, `failed` in the same place if it cannot load.
 * `label` names the piece in error reports; `defects` is the caller's choice
 * of what any other error does (see `DefectHandling`).
 */
export function LazyIsland({
  loading = null,
  failed,
  label,
  defects,
  children,
}: Readonly<{
  loading?: ReactNode;
  failed: ReactNode;
  label: string;
  defects: DefectHandling;
  children: ReactNode;
}>) {
  return (
    <IslandBoundary failed={failed} label={label} defects={defects}>
      <Suspense fallback={loading}>{children}</Suspense>
    </IslandBoundary>
  );
}

/** The quiet stand-in for a piece that could not load, centred in its box. */
export function IslandUnavailable({ message }: Readonly<{ message: string }>) {
  return (
    <div className="grid h-full place-items-center">
      <p className={textRole('caption', 'text-ink-muted')}>{message}</p>
    </div>
  );
}
