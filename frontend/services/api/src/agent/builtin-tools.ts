/**
 * The Agent's three built-in tools. They are not reads: `load_skill` supplies a
 * methodology, `save_document` stages the whole deliverable and
 * `edit_document` stages exact replacements in it. The runtime commits the
 * staged document with the reply in one transaction. Each refusal says
 * how to correct the call, so the model fixes it instead of the turn ending.
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

/** What the built-ins read and change during one turn. */
export type DocumentState = {
  skill: Skill | undefined;
  skillSource: string | null;
  /** The kind of the chat's existing deliverable, if any. */
  outputKind: string | null;
  /** The saved or pinned format, used when a save names none. */
  formatId: string | null;
  /** The chat's latest revision, which an edit changes until this turn stages its own. */
  document: { title: string; body: string } | null;
  staged: OutputPayload | null;
};
export type BuiltinOutcome = { ok: boolean; text: string };

const optional = <T extends z.ZodType>(schema: T) => schema.nullish();

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
  'Save the whole deliverable as this chat’s document, after load_skill. It is saved together with your reply. For a change to an existing document, prefer edit_document. Returns what was saved.';
const EDIT_DESCRIPTION =
  'Change this chat’s current document with exact replacements instead of rewriting it: each old_string must appear exactly once. All edits apply or none do. It is saved together with your reply.';

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
  // A chat keeps one document, so its kind is fixed once something is saved or staged.
  const kind = state.outputKind ?? (state.staged ? state.skill?.outputKind : null);
  if (kind && skill.outputKind !== kind)
    return {
      ok: false,
      text: `This chat’s document is of kind “${kind}” and this methodology writes “${skill.outputKind}”, so it cannot be used here. Answer in your reply instead, or offer to continue in a new chat.`,
    };
  state.skill = skill;
  state.skillSource = 'model';
  return { ok: true, text: methodology(skill, state, bounds) };
}

function staged(
  catalog: SkillCatalog,
  state: DocumentState,
  payload: unknown,
  bounds: OutputBounds,
  done: string,
): BuiltinOutcome {
  const checked = outputSchema(bounds).safeParse(payload);
  if (!checked.success)
    return {
      ok: false,
      text: `Give a nonblank title of at most ${bounds.output_title_max_chars} characters and a nonblank body of at most ${bounds.output_body_max_chars} characters.`,
    };
  state.staged = checked.data;
  const format = checked.data.format_id;
  const label = format ? ` in ${catalog.formats?.get(format)?.label ?? format} format` : '';
  return {
    ok: true,
    text: `${done}${label}; it is saved with your reply. Now reply briefly; do not repeat the document.`,
  };
}

export function saveDocument(
  catalog: SkillCatalog,
  state: DocumentState,
  input: unknown,
  bounds: OutputBounds,
): BuiltinOutcome {
  const { skill } = state;
  if (!skill)
    return {
      ok: false,
      text: 'Load the methodology with load_skill first, then save the document.',
    };
  const parsed = schemas(catalog, bounds).save.safeParse(input);
  if (!parsed.success) return { ok: false, text: argumentProblem(parsed.error) };
  const formats = catalog.formats;
  const format = usesFormats(skill) ? (parsed.data.format_id ?? state.formatId) : null;
  if (formats && usesFormats(skill) && !formats.has(format ?? ''))
    return { ok: false, text: `Set format_id to one of: ${[...formats.keys()].join(', ')}.` };
  return staged(
    catalog,
    state,
    {
      ...parsed.data,
      format_id: format,
      title: scrubRecordRefs(parsed.data.title),
      body: scrubRecordRefs(parsed.data.body),
    },
    bounds,
    'Staged the document',
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

export function editDocument(
  catalog: SkillCatalog,
  state: DocumentState,
  input: unknown,
  bounds: OutputBounds,
): BuiltinOutcome {
  const { skill } = state;
  const base = state.staged ?? state.document;
  if (!base)
    return {
      ok: false,
      text: 'This chat has no document yet. Write it with save_document.',
    };
  if (!skill) return { ok: false, text: 'Load the methodology with load_skill first, then edit.' };
  const parsed = schemas(catalog, bounds).edit.safeParse(input);
  if (!parsed.success) return { ok: false, text: argumentProblem(parsed.error) };
  const result = replaced(base.body, parsed.data.edits);
  if (!result.ok) return result;
  const count = parsed.data.edits.length;
  return staged(
    catalog,
    state,
    {
      target_kind: null,
      target: null,
      format_id: usesFormats(skill) ? state.formatId : null,
      ...state.staged,
      title: scrubRecordRefs(parsed.data.title ?? base.title),
      body: scrubRecordRefs(result.text),
    },
    bounds,
    `Applied ${editLabel(count)}`,
  );
}
