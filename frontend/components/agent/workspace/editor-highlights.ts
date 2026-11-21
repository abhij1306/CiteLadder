import { MapMode, StateEffect, StateField, type ChangeDesc } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

import type { SuggestionHighlight } from '@/lib/agent/page-workspace';

export const setHighlights = StateEffect.define<readonly SuggestionHighlight[]>();

function mapHighlights(
  highlights: readonly SuggestionHighlight[],
  changes: ChangeDesc,
): readonly SuggestionHighlight[] {
  return highlights.flatMap((highlight) => {
    const from = changes.mapPos(highlight.from, 1, MapMode.TrackDel);
    const to = changes.mapPos(highlight.to, -1, MapMode.TrackDel);
    if (from === null || to === null || to <= from) return [];
    return [{ ...highlight, from, to }];
  });
}

function decorations(highlights: readonly SuggestionHighlight[]): DecorationSet {
  return Decoration.set(
    highlights.map((highlight) =>
      Decoration.mark({
        tagName: 'mark',
        class: `page-editor-suggestion page-editor-suggestion-${highlight.tone}`,
        attributes: { 'data-suggestion-id': highlight.id, title: highlight.label },
      }).range(highlight.from, highlight.to),
    ),
    true,
  );
}

export const highlightField = StateField.define<readonly SuggestionHighlight[]>({
  create: () => [],
  update(highlights, transaction) {
    for (const effect of transaction.effects) if (effect.is(setHighlights)) return effect.value;
    return transaction.docChanged ? mapHighlights(highlights, transaction.changes) : highlights;
  },
  provide: (field) => EditorView.decorations.from(field, decorations),
});

export function highlightAt(
  highlights: readonly SuggestionHighlight[],
  position: number,
): SuggestionHighlight | null {
  let found: SuggestionHighlight | null = null;
  for (const highlight of highlights) {
    if (position < highlight.from || position > highlight.to) continue;
    if (!found || highlight.to - highlight.from < found.to - found.from) found = highlight;
  }
  return found;
}
