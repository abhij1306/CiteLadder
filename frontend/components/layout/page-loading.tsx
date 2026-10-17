import { useEffect, useState } from 'react';

import { LOADING_INDICATOR_DELAY_MS } from '@/lib/config/operational';
import { Spinner } from '@/components/ui/spinner';

/**
 * PageLoading — the ONE first-load placeholder every workspace screen shows.
 *
 * Each screen used to own a bespoke skeleton, and none of them agreed: the
 * card strip on Performance, two stacked bars on Opportunities, a tab rail on
 * Site Health. Entering the app therefore redrew the viewport three times —
 * shell placeholder, then that screen's particular skeleton, then the content
 * — each with a different geometry. A skeleton only avoids a shift when it
 * matches the content it stands in for, and a skeleton that has to stand in
 * for a table, a chart, and an empty state at once cannot match any of them.
 *
 * So the first load is a single calm state instead: one reserved block, one
 * centred spinner, identical on every screen. The only transition a reader
 * sees is placeholder -> content, and the block above the fold keeps its size
 * across that swap.
 *
 * This is for a SCREEN waiting on its first load. A section refreshing inside
 * an already-drawn page keeps its own in-place treatment — that surface's
 * boxes already exist and must not collapse.
 *
 * The spinner itself is held back for a moment (`loading-delayed`), so a wait
 * short enough to go unnoticed passes without one. The reserved block is not:
 * it holds its height from the first frame, so the content that lands into it
 * lands in a box that was already there.
 */
export function PageLoading({
  label = 'Loading…',
}: Readonly<{
  /** What is loading, announced to assistive technology. */
  label?: string;
}>) {
  // The spinner stays invisible for a beat (`loading-delayed`); hold the
  // `status` announcement with it, so assistive technology never announces a
  // loading state nothing on screen shows yet.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setRevealed(true), LOADING_INDICATOR_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="grid min-h-[60vh] place-items-center" data-testid="page-loading">
      <span className="loading-delayed">
        <Spinner size="lg" label={revealed ? label : undefined} className="text-muted" />
      </span>
    </div>
  );
}
