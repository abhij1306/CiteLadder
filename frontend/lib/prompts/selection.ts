import { useState } from 'react';

export type RowSelection = Readonly<{ ids: ReadonlySet<string>; anchor: string | null }>;

const EMPTY: RowSelection = { ids: new Set(), anchor: null };

export function toggleRow(
  selection: RowSelection,
  change: Readonly<{ order: readonly string[]; id: string; checked: boolean; range: boolean }>,
): RowSelection {
  const { order, id, checked, range } = change;
  const from = range && selection.anchor !== null ? order.indexOf(selection.anchor) : -1;
  const to = order.indexOf(id);
  const span =
    from >= 0 && to >= 0 ? order.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
  const ids = new Set(selection.ids);
  for (const each of span) {
    if (checked) ids.add(each);
    else ids.delete(each);
  }
  return { ids, anchor: id };
}

export function togglePage(
  selection: RowSelection,
  pageIds: readonly string[],
  checked: boolean,
): RowSelection {
  const ids = new Set(selection.ids);
  for (const id of pageIds) {
    if (checked) ids.add(id);
    else ids.delete(id);
  }
  return { ids, anchor: selection.anchor };
}

export function useRowSelection<T extends { id: string }>(rows: readonly T[], view: string) {
  const [selection, setSelection] = useState<RowSelection>(EMPTY);
  const [selectedView, setSelectedView] = useState(view);
  if (view !== selectedView) {
    setSelectedView(view);
    setSelection(EMPTY);
  }
  const selected = rows.filter((row) => selection.ids.has(row.id));
  return {
    ids: selection.ids,
    selected,
    toggle: (id: string, checked: boolean, range: boolean) =>
      setSelection((current) =>
        toggleRow(current, { order: rows.map((row) => row.id), id, checked, range }),
      ),
    togglePage: (pageIds: readonly string[], checked: boolean) =>
      setSelection((current) => togglePage(current, pageIds, checked)),
    clear: () => setSelection(EMPTY),
  };
}

export type RowSelectionState = ReturnType<typeof useRowSelection>;
