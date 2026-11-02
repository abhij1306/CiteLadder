/** Scored page-kind composition between the previous comparable snapshot and this crawl. */
import { compareText } from '../text-order.ts';

type CountByKind = Readonly<Record<string, number>>;

function total(counts: CountByKind) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

/**
 * A kind's share moved by at least `shareShiftPoints` percentage points.
 * Compared by cross-multiplication so integer counts never meet float rounding:
 * |c/C - p/P| * 100 >= t  ⇔  |c·P - p·C| * 100 >= t·P·C.
 */
function shareShifted(
  previous: number,
  previousTotal: number,
  current: number,
  currentTotal: number,
  shareShiftPoints: number,
) {
  if (previousTotal === 0 || currentTotal === 0) return previousTotal !== currentTotal;
  return (
    Math.abs(current * previousTotal - previous * currentTotal) * 100 >=
    shareShiftPoints * previousTotal * currentTotal
  );
}

/**
 * Composition changed when a page kind joined or left the scored cohort, or any
 * kind's share of it moved by the configured threshold; plain count drift below
 * that keeps the snapshots comparable without composition context.
 */
export function cohortComposition({
  previous,
  current,
  shareShiftPoints,
}: Readonly<{ previous: CountByKind; current: CountByKind; shareShiftPoints: number }>) {
  const added = Object.keys(current)
    .filter((kind) => !(kind in previous))
    .toSorted(compareText);
  const removed = Object.keys(previous)
    .filter((kind) => !(kind in current))
    .toSorted(compareText);
  const previousTotal = total(previous);
  const currentTotal = total(current);
  const changed =
    added.length > 0 ||
    removed.length > 0 ||
    Object.keys(current).some((kind) =>
      shareShifted(
        previous[kind] ?? 0,
        previousTotal,
        current[kind] ?? 0,
        currentTotal,
        shareShiftPoints,
      ),
    );
  return {
    changed,
    composition: {
      added_page_kinds: added,
      removed_page_kinds: removed,
      previous_page_count_by_kind: previous,
      current_page_count_by_kind: current,
    },
  };
}
