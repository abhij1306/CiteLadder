import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, type ViewUpdate } from '@codemirror/view';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';

import type { SuggestionHighlight } from '@/lib/agent/page-workspace';

import { highlightAt, highlightField, setHighlights } from './editor-highlights';
import { livePreview } from './editor-preview';

/** What the workspace asks of the editor: show a suggestion's text, or a heading. */
export type PageEditorHandle = {
  /** Selects the suggestion's text and scrolls it to the middle of the page. */
  revealHighlight: (id: string) => void;
  /** Puts the cursor at an offset and scrolls it to the top of the page. */
  jumpTo: (position: number) => void;
};

/** A change the workspace made (a fresh revision, the Agent's streamed edit), not the person. */
const external = Annotation.define<boolean>();

function access(readOnly: boolean): Extension {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({ 'aria-readonly': String(readOnly) }),
  ];
}

type Callbacks = {
  onChange: (text: string) => void;
  onSelection: (text: string) => void;
  onHighlight: (id: string) => void;
};

/** Reports the person's edits, what they selected, and a highlight the caret moved into. */
function listener(callbacks: { current: Callbacks }) {
  let selected = '';
  return EditorView.updateListener.of((update: ViewUpdate) => {
    const { state } = update;
    const person = update.transactions.some((transaction) => !transaction.annotation(external));
    if (update.docChanged && person) callbacks.current.onChange(state.doc.toString());
    if (!update.selectionSet && !update.docChanged) return;
    const main = state.selection.main;
    const text = main.empty ? '' : state.sliceDoc(main.from, main.to);
    if (text !== selected) callbacks.current.onSelection(text);
    selected = text;
    const moved = update.transactions.some((transaction) => transaction.isUserEvent('select'));
    const under = moved && main.empty ? highlightAt(state.field(highlightField), main.head) : null;
    if (under) callbacks.current.onHighlight(under.id);
  });
}

/** A press on a highlight opens its card, in a read-only page too. */
const highlightPress = (callbacks: { current: Callbacks }) =>
  EditorView.domEventHandlers({
    click: (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const marked = target?.closest('[data-suggestion-id]');
      const id = marked instanceof HTMLElement ? marked.dataset.suggestionId : undefined;
      if (id) callbacks.current.onHighlight(id);
      return false;
    },
  });

/** Highlights inside the document, so a stale read can never place one past its end. */
const within = (highlights: readonly SuggestionHighlight[], length: number) =>
  highlights.filter((highlight) => highlight.to <= length);

/**
 * The page document's Markdown body in CodeMirror with live preview (E2). The
 * person's edits are reported through `onChange`; the workspace owns the
 * draft and saves it as a revision. While `editing` is false the editor shows
 * `text` (the latest revision, or the Agent's edit as it streams) and the
 * suggestions' highlights; while the person edits, highlights map through
 * every change and a new `text` waits until the draft is saved or discarded.
 */
export function PageEditor({
  ref,
  label,
  text,
  editing,
  readOnly,
  highlights,
  onChange,
  onSelection,
  onHighlight,
}: Readonly<
  Callbacks & {
    ref?: Ref<PageEditorHandle>;
    label: string;
    text: string;
    editing: boolean;
    readOnly: boolean;
    highlights: readonly SuggestionHighlight[];
  }
>) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const readOnlyMode = useRef(new Compartment());
  const callbacks = useRef<Callbacks>({ onChange, onSelection, onHighlight });
  useEffect(() => {
    callbacks.current = { onChange, onSelection, onHighlight };
  });
  // The first render's values build the editor; later ones reach it through the effects below.
  const initial = useRef({ text, label, readOnly });

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const created = new EditorView({
      parent,
      state: EditorState.create({
        doc: initial.current.text,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': initial.current.label }),
          readOnlyMode.current.of(access(initial.current.readOnly)),
          livePreview,
          highlightField,
          listener(callbacks),
          highlightPress(callbacks),
        ],
      }),
    });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: readOnlyMode.current.reconfigure(access(readOnly)) });
  }, [readOnly]);

  // A new revision or a streamed edit replaces the text unless the person is editing.
  useEffect(() => {
    const current = view.current;
    if (!current || editing || current.state.doc.toString() === text) return;
    current.dispatch({
      changes: { from: 0, to: current.state.doc.length, insert: text },
      effects: setHighlights.of([]),
      annotations: external.of(true),
    });
  }, [text, editing]);

  useEffect(() => {
    const current = view.current;
    if (!current || editing) return;
    current.dispatch({
      effects: setHighlights.of(within(highlights, current.state.doc.length)),
      annotations: external.of(true),
    });
  }, [highlights, editing, text]);

  useImperativeHandle(ref, () => ({
    revealHighlight: (id) => {
      const current = view.current;
      const found = current?.state.field(highlightField).find((highlight) => highlight.id === id);
      if (!current || !found) return;
      current.dispatch({
        selection: { anchor: found.from, head: found.to },
        effects: EditorView.scrollIntoView(found.from, { y: 'center' }),
        annotations: external.of(true),
      });
      current.focus();
    },
    jumpTo: (position) => {
      const current = view.current;
      if (!current) return;
      const anchor = Math.min(position, current.state.doc.length);
      current.dispatch({
        selection: { anchor },
        effects: EditorView.scrollIntoView(anchor, { y: 'start' }),
        annotations: external.of(true),
      });
      current.focus();
    },
  }));

  return <div ref={host} className="page-editor" data-read-only={readOnly || undefined} />;
}
