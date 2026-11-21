import { Component, Suspense, type ReactNode } from 'react';

import { textRole } from '@/components/ui/typography';
import { isChunkLoadError, reportClientError } from '@/lib/client-errors';

type DefectHandling = 'surface' | 'contain';

type BoundaryProps = Readonly<{
  failed: ReactNode;
  label: string;
  defects: DefectHandling;
  children: ReactNode;
}>;

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
    return null;
  }
}

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

export function IslandUnavailable({ message }: Readonly<{ message: string }>) {
  return (
    <div className="grid h-full place-items-center">
      <p className={textRole('caption', 'text-ink-2')}>{message}</p>
    </div>
  );
}
