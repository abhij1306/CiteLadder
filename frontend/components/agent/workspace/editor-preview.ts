/**
 * Live-preview styling for the page editor (E2): headings, bold, italics and
 * links render styled, and their Markdown marks are hidden except on the
 * lines the cursor is on while the editor has focus. Hiding never removes
 * text, so offsets stay the server's and suggestions anchor exactly.
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';

/** A node of the Markdown syntax tree as an iteration visits it. */
type SyntaxNodeRef = Parameters<
  Parameters<ReturnType<typeof syntaxTree>['iterate']>[0]['enter']
>[0];
const HIDDEN = Decoration.replace({});
const STRONG = Decoration.mark({ class: 'page-editor-strong' });
const EMPHASIS = Decoration.mark({ class: 'page-editor-em' });
const LINK = Decoration.mark({ class: 'page-editor-link' });
const HEADING_LINES = [1, 2, 3, 4, 5, 6].map((level) =>
  Decoration.line({ class: `page-editor-h${level}` }),
);

/** What one pass over the visible syntax tree collects. */
type Pass = {
  state: EditorState;
  /** Lines whose marks stay visible: the cursor's, while the editor has focus. */
  active: ReadonlySet<number>;
  ranges: Range<Decoration>[];
};

function hideMark(pass: Pass, from: number, to: number) {
  if (to <= from || pass.active.has(pass.state.doc.lineAt(from).number)) return;
  pass.ranges.push(HIDDEN.range(from, to));
}

/** An ATX heading's `#` run and the space after it; a setext underline stays. */
function hideHeaderMark(pass: Pass, node: SyntaxNodeRef) {
  if (!node.node.parent?.name.startsWith('ATXHeading')) return;
  const spaced = pass.state.doc.sliceString(node.to, node.to + 1) === ' ';
  hideMark(pass, node.from, spaced ? node.to + 1 : node.to);
}

/** A link's brackets and destination; an autolink's URL is its text and stays. */
function hideLinkPart(pass: Pass, node: SyntaxNodeRef) {
  if (node.name === 'URL' && node.node.parent?.name !== 'Link') return;
  hideMark(pass, node.from, node.to);
}

const MARKS: Readonly<Record<string, Decoration>> = {
  StrongEmphasis: STRONG,
  Emphasis: EMPHASIS,
  Link: LINK,
};

const HIDERS: Readonly<Record<string, (pass: Pass, node: SyntaxNodeRef) => void>> = {
  HeaderMark: hideHeaderMark,
  EmphasisMark: (pass, node) => hideMark(pass, node.from, node.to),
  LinkMark: hideLinkPart,
  URL: hideLinkPart,
  LinkTitle: hideLinkPart,
};

function visit(pass: Pass, node: SyntaxNodeRef) {
  const heading = /^ATXHeading([1-6])$/.exec(node.name)?.[1];
  const line = heading ? HEADING_LINES[Number(heading) - 1] : undefined;
  if (line) pass.ranges.push(line.range(pass.state.doc.lineAt(node.from).from));
  const mark = MARKS[node.name];
  if (mark && node.to > node.from) pass.ranges.push(mark.range(node.from, node.to));
  HIDERS[node.name]?.(pass, node);
}

function activeLines(view: EditorView): ReadonlySet<number> {
  const lines = new Set<number>();
  if (!view.hasFocus) return lines;
  const { doc } = view.state;
  for (const range of view.state.selection.ranges) {
    const last = doc.lineAt(range.to).number;
    for (let line = doc.lineAt(range.from).number; line <= last; line++) lines.add(line);
  }
  return lines;
}

function previewDecorations(view: EditorView): DecorationSet {
  const pass: Pass = { state: view.state, active: activeLines(view), ranges: [] };
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges)
    tree.iterate({ from, to, enter: (node) => visit(pass, node) });
  return Decoration.set(pass.ranges, true);
}

function needsRedraw(update: ViewUpdate): boolean {
  return (
    update.docChanged ||
    update.viewportChanged ||
    update.selectionSet ||
    update.focusChanged ||
    syntaxTree(update.startState) !== syntaxTree(update.state)
  );
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = previewDecorations(view);
    }
    update(update: ViewUpdate) {
      if (needsRedraw(update)) this.decorations = previewDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
