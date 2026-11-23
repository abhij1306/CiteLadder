import { compareText } from '../text-order.ts';

type CountByKind = Readonly<Record<string, number>>;

function total(counts: CountByKind) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

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
