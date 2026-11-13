import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vite-plus/test';

import type { SuggestionHighlight } from '@/lib/agent/page-workspace';

import { highlightAt, highlightField, setHighlights } from './editor-highlights';

const BODY = 'Our plans start at ten dollars.';
// "ten dollars"
const SPAN: SuggestionHighlight = { id: 'a', from: 19, to: 30, tone: 'ready', label: 'Clarity' };

function stateWith(highlights: readonly SuggestionHighlight[]) {
  const state = EditorState.create({ doc: BODY, extensions: [highlightField] });
  return state.update({ effects: setHighlights.of(highlights) }).state;
}

const textOf = (state: EditorState) =>
  state.field(highlightField).map((highlight) => state.sliceDoc(highlight.from, highlight.to));

describe('highlightField', () => {
  it('keeps a highlight on its text when the person types before it', () => {
    const state = stateWith([SPAN]).update({ changes: { from: 0, insert: 'Today, ' } }).state;
    expect(textOf(state)).toEqual(['ten dollars']);
  });

  it('keeps a highlight on its text when the person types inside it', () => {
    const state = stateWith([SPAN]).update({ changes: { from: 22, insert: ' US' } }).state;
    expect(textOf(state)).toEqual(['ten US dollars']);
  });

  it('drops a highlight once a deletion crosses its start or end', () => {
    // Deletes "at ten", across the highlight's start.
    const state = stateWith([SPAN]).update({ changes: { from: 16, to: 22 } }).state;
    expect(state.doc.toString()).toBe('Our plans start  dollars.');
    expect(state.field(highlightField)).toEqual([]);
  });

  it('replaces every highlight when a new read places them', () => {
    const other: SuggestionHighlight = { ...SPAN, id: 'b', from: 0, to: 9 };
    const state = stateWith([SPAN]).update({ effects: setHighlights.of([other]) }).state;
    expect(textOf(state)).toEqual(['Our plans']);
  });
});

describe('highlightAt', () => {
  it('finds the innermost highlight under a position', () => {
    const inner: SuggestionHighlight = { ...SPAN, id: 'inner', from: 23, to: 30 };
    expect(highlightAt([SPAN, inner], 25)?.id).toBe('inner');
    expect(highlightAt([SPAN, inner], 20)?.id).toBe('a');
    expect(highlightAt([SPAN, inner], 3)).toBeNull();
  });
});
