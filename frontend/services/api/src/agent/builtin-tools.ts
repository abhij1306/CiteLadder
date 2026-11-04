/**
 * The Agent's three built-in tools. They are not reads: `load_skill` supplies a
 * methodology, `save_document` stages a whole document and `edit_document`
 * stages exact replacements in one. A chat holds several documents, each
 * named by its number ("Document 2"); the runtime commits every staged
 * document with the reply in one transaction. Each refusal says how to
 * correct the call, so the model fixes it instead of the turn ending.
 */
import { z } from 'zod';
import { argumentProblem } from '../mcp/tools.ts';
import type { ConversationTool } from '../models/conversation.ts';
import { compareText } from '../text-order.ts';
import {
  outputSchema,
  type OutputBounds,
  type OutputPayload,
  type Skill,
  type SkillCatalog,
} from './contracts.ts';
import { usesFormats } from './skills.ts';
import { scrubRecordRefs } from './sources.ts';
import { toolDefinitions, type ToolRegistry } from './tools.ts';

export const LOAD_SKILL = 'load_skill';
export const SAVE_DOCUMENT = 'save_document';
export const EDIT_DOCUMENT = 'edit_document';

/** The short label a document is named by, for the model and the person. */
export function documentLabel(number: number) {
  return `Document ${number}`;
}
/** A built-in's result about one document starts with its label, so a replayed turn says which. */
export const DOCUMENT_RESULT = /^Document (\d+)\b/u;

/** One of the chat's saved documents, as the turn read it. */
export type SavedDocument = {
  number: number;
  kind: string;
  skillId: string;
  formatId: string | null;
  title: string;
  body: string;
};
/** A document this turn staged: a new one or a revision of a saved one. */
type StagedDocument = { kind: string; skillId: string; payload: OutputPayload };

/** What the built-ins read and change during one turn. */
export type DocumentState = {
  skill: Skill | undefined;
  skillSource: string | null;
  /** The pinned format, else the latest document's, used when a new document names none. */
  formatId: string | null;
  /** The chat's saved documents, in number order. */
  documents: SavedDocument[];
  /** This turn's staged documents by number; committed only with the reply. */
  staged: Map<number, StagedDocument>;
};
export type BuiltinOutcome = { ok: boolean; text: string; document?: number };

const optional = <T extends z.ZodType>(schema: T) => schema.nullish();
const documentNumber = z
  .number()
  .int()
  .positive()
  .describe('The document’s number from this chat’s document list.');

function schemas(catalog: SkillCatalog, bounds: OutputBounds) {
  const [firstSkill = '', ...skills] = [...catalog.skills.keys()];
  const formats = [...(catalog.formats?.keys() ?? [])];
  const [firstFormat, ...otherFormats] = formats;
  return {
    load: z.strictObject({
      skill_id: z
        .enum([firstSkill, ...skills])
        .describe('The methodology for the requested deliverable.'),
    }),
    save: z.strictObject({
      document: optional(
        documentNumber.describe(
          'The number of the document this replaces whole; omit it to save a new document.',
        ),
      ),
      title: z
        .string()
        .describe(`A descriptive title, at most ${bounds.output_title_max_chars} characters.`),
      body: z
        .string()
        .describe(
          `The whole document in Markdown, at most ${bounds.output_body_max_chars} characters.`,
        ),
      format_id: optional(
        firstFormat === undefined
          ? z.string()
          : z
              .enum([firstFormat, ...otherFormats])
              .describe('The content format, when the methodology uses formats.'),
      ),
      target_kind: optional(z.enum(['page', 'planned_page'])),
      target: optional(z.string().describe('The page this document is for, when it has one.')),
    }),
    edit: z.strictObject({
      document: optional(
        documentNumber.describe(
          'The number of the document to change; needed when the chat has more than one.',
        ),
      ),
      edits: z
        .array(
          z.strictObject({
            old_string: z
              .string()
              .min(1)
              .describe('Exact text from the current document, matching once.'),
            new_string: z.string().describe('The replacement text; empty deletes old_string.'),
          }),
        )
        .min(1)
        .describe('Replacements applied in order; each sees the result of the ones before it.'),
      title: optional(z.string().describe('A new title, when the title changes.')),
    }),
  };
}

const LOAD_DESCRIPTION =
  'Load the methodology for a deliverable you were asked for (a document, plan or content). Call it before writing the deliverable; a question needs no methodology. Returns the method and the rules for saving.';
const SAVE_DESCRIPTION =
  'Save a whole document, after load_skill: omit document to add a new document to this chat, or give a document’s number to replace it whole. For a change to an existing document, prefer edit_document. It is saved together with your reply.';
const EDIT_DESCRIPTION =
  'Change one of this chat’s documents with exact replacements instead of rewriting it: each old_string must appear exactly once. All edits apply or none do. It is saved together with your reply.';

/** The model's full tool list: the reads plus the built-ins, sorted, so the cached prefix is stable. */
export function agentToolList(
  registry: ToolRegistry,
  catalog: SkillCatalog,
  bounds: OutputBounds,
): ConversationTool[] {
  const { load, save, edit } = schemas(catalog, bounds);
  const builtins = toolDefinitions([
    { name: LOAD_SKILL, description: LOAD_DESCRIPTION, arguments: load },
    { name: SAVE_DOCUMENT, description: SAVE_DESCRIPTION, arguments: save },
    { name: EDIT_DOCUMENT, description: EDIT_DESCRIPTION, arguments: edit },
  ]).map((tool) => (tool.name === SAVE_DOCUMENT ? { ...tool, stream_input: true } : tool));
  return [...registry.catalog(), ...builtins].toSorted((a, b) => compareText(a.name, b.name));
}

export function isBuiltin(name: string) {
  return name === LOAD_SKILL || name === SAVE_DOCUMENT || name === EDIT_DOCUMENT;
}

/** The method plus the rules for saving it, as `load_skill` returns and a pinned skill is supplied. */
export function methodology(
  skill: Skill,
  state: Pick<DocumentState, 'formatId'>,
  bounds: OutputBounds,
) {
  const current = state.formatId
    ? `; this chat uses ${state.formatId} unless asked for another`
    : '';
  const rules = [
    `Save the deliverable with save_document: a title of at most ${bounds.output_title_max_chars} characters and a Markdown body of at most ${bounds.output_body_max_chars} characters. Change an existing document with edit_document.`,
    usesFormats(skill)
      ? `Name its format in format_id, from the content formats in your instructions${current}.`
      : '',
  ];
  return [`Methodology: ${skill.id} (${skill.outputKind})`, skill.body, ...rules]
    .filter(Boolean)
    .join('\n\n');
}

/** Any methodology may be loaded: a document of another kind is saved as a new document. */
export function loadSkill(
  catalog: SkillCatalog,
  state: DocumentState,
  input: unknown,
  bounds: OutputBounds,
): BuiltinOutcome {
  const parsed = schemas(catalog, bounds).load.safeParse(input);
  if (!parsed.success) return { ok: false, text: argumentProblem(parsed.error) };
  const skill = catalog.skills.get(parsed.data.skill_id);
  if (!skill)
    return { ok: false, text: `Set skill_id to one of: ${[...catalog.skills.keys()].join(', ')}.` };
  if (state.skill?.id === skill.id)
    return { ok: true, text: 'This methodology is already loaded. Apply it.' };
  state.skill = skill;
  state.skillSource = 'model';
  return { ok: true, text: methodology(skill, state, bounds) };
}

/** Every number in use: the saved documents and this turn's new ones. */
function numbers(state: DocumentState) {
  return [
    ...new Set([...state.documents.map((document) => document.number), ...state.staged.keys()]),
  ];
}
/** A document as the turn now holds it: staged this turn, else as saved. */
function current(state: DocumentState, number: number) {
  const staged = state.staged.get(number);
  const saved = state.documents.find((document) => document.number === number);
  if (staged)
    return {
      kind: staged.kind,
      skillId: staged.skillId,
      formatId: staged.payload.format_id ?? null,
      title: staged.payload.title,
      body: staged.payload.body,
      target_kind: staged.payload.target_kind ?? null,
      target: staged.payload.target ?? null,
    };
  return saved ? { ...saved, target_kind: null, target: null } : null;
}
function unknownDocument(state: DocumentState, number: number) {
  const known = numbers(state);
  return known.length
    ? `This chat has no ${documentLabel(number)}. Use one of: ${known.map(documentLabel).join(', ')}.`
    : 'This chat has no documents yet. Write one with save_document.';
}

function staged(
  catalog: SkillCatalog,
  state: DocumentState,
  number: number,
  document: Omit<StagedDocument, 'payload'> & { payload: unknown },
  bounds: OutputBounds,
  done: string,
): BuiltinOutcome {
  const checked = outputSchema(bounds).safeParse(document.payload);
  if (!checked.success)
    return {
      ok: false,
      text: `Give a nonblank title of at most ${bounds.output_title_max_chars} characters and a nonblank body of at most ${bounds.output_body_max_chars} characters.`,
    };
  state.staged.set(number, {
    kind: document.kind,
    skillId: document.skillId,
    payload: checked.data,
  });
  const format = checked.data.format_id;
  const label = format ? ` in ${catalog.formats?.get(format)?.label ?? format} format` : '';
  return {
    ok: true,
    document: number,
    text: `${documentLabel(number)}: ${done}${label}; it is saved with your reply. Now reply briefly; do not repeat the document.`,
  };
}

/**
 * Stages a whole document. A number replaces that document and must match the
 * loaded methodology's kind; without one the document is new. `step` holds the
 * documents already saved whole in this response: the first save of each is kept.
 */
export function saveDocument(
  catalog: SkillCatalog,
  state: DocumentState,
  input: unknown,
  bounds: OutputBounds,
  step: ReadonlySet<number> = new Set(),
): BuiltinOutcome {
  const { skill } = state;
  if (!skill)
    return {
      ok: false,
      text: 'Load the methodology with load_skill first, then save the document.',
    };
  const parsed = schemas(catalog, bounds).save.safeParse(input);
  if (!parsed.success) return { ok: false, text: argumentProblem(parsed.error) };
  const { document: requested, ...fields } = parsed.data;
  const existing = requested ? current(state, requested) : null;
  if (requested && !existing) return { ok: false, text: unknownDocument(state, requested) };
  if (existing && existing.kind !== skill.outputKind)
    return {
      ok: false,
      text: `${documentLabel(requested!)} is a “${existing.kind}” document and this methodology writes “${skill.outputKind}”. Omit document to save this as a new document, or load a “${existing.kind}” methodology to replace it.`,
    };
  if (requested && step.has(requested))
    return {
      ok: false,
      text: `Save ${documentLabel(requested)} once per step. The first save in this step was kept.`,
    };
  const number = requested ?? Math.max(0, ...numbers(state)) + 1;
  const formats = catalog.formats;
  const format = usesFormats(skill)
    ? (fields.format_id ?? existing?.formatId ?? state.formatId)
    : null;
  if (formats && usesFormats(skill) && !formats.has(format ?? ''))
    return { ok: false, text: `Set format_id to one of: ${[...formats.keys()].join(', ')}.` };
  return staged(
    catalog,
    state,
    number,
    {
      kind: skill.outputKind,
      skillId: existing?.skillId ?? skill.id,
      payload: {
        ...fields,
        format_id: format,
        title: scrubRecordRefs(fields.title),
        body: scrubRecordRefs(fields.body),
      },
    },
    bounds,
    requested ? 'staged the new version' : 'staged as a new document',
  );
}

/** Applies every replacement in order, or none: each must match exactly once. */
function replaced(
  body: string,
  edits: { old_string: string; new_string: string }[],
): BuiltinOutcome {
  let text = body;
  for (const [index, edit] of edits.entries()) {
    const at = text.indexOf(edit.old_string);
    const label = edits.length > 1 ? `Edit ${index + 1}: ` : '';
    if (at < 0)
      return {
        ok: false,
        text: `${label}old_string is not in the current document. Copy it exactly, including whitespace and Markdown. No edits were applied.`,
      };
    if (text.includes(edit.old_string, at + 1))
      return {
        ok: false,
        text: `${label}old_string appears more than once. Include more surrounding text so it matches exactly once. No edits were applied.`,
      };
    text = text.slice(0, at) + edit.new_string + text.slice(at + edit.old_string.length);
  }
  return { ok: true, text };
}

function editLabel(count: number) {
  return count === 1 ? 'the edit' : `${count} edits`;
}

/** Stages exact replacements in one document; it keeps its kind, methodology and format. */
export function editDocument(
  catalog: SkillCatalog,
  state: DocumentState,
  input: unknown,
  bounds: OutputBounds,
): BuiltinOutcome {
  const known = numbers(state);
  const [only, ...others] = known;
  if (only === undefined)
    return { ok: false, text: 'This chat has no documents yet. Write one with save_document.' };
  const parsed = schemas(catalog, bounds).edit.safeParse(input);
  if (!parsed.success) return { ok: false, text: argumentProblem(parsed.error) };
  const number = parsed.data.document ?? (others.length === 0 ? only : null);
  if (number === null)
    return {
      ok: false,
      text: `Set document to the number of the document to change: one of ${known.map(documentLabel).join(', ')}.`,
    };
  const base = current(state, number);
  if (!base) return { ok: false, text: unknownDocument(state, number) };
  const result = replaced(base.body, parsed.data.edits);
  if (!result.ok) return result;
  const count = parsed.data.edits.length;
  return staged(
    catalog,
    state,
    number,
    {
      kind: base.kind,
      skillId: base.skillId,
      payload: {
        target_kind: base.target_kind,
        target: base.target,
        format_id: base.formatId,
        title: scrubRecordRefs(parsed.data.title ?? base.title),
        body: scrubRecordRefs(result.text),
      },
    },
    bounds,
    `applied ${editLabel(count)}`,
  );
}
