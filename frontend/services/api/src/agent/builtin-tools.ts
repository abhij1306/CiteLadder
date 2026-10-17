/**
 * The Agent's two built-in tools. They are not reads: `load_skill` supplies a
 * methodology and `save_document` stages the turn's deliverable, which the
 * runtime commits with the reply in one transaction. Each refusal says
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
import { outlineRequired, usesFormats } from './skills.ts';
import { scrubRecordRefs } from './sources.ts';
import { toolDefinitions, type ToolRegistry } from './tools.ts';

export const LOAD_SKILL = 'load_skill';
export const SAVE_DOCUMENT = 'save_document';

/** What the built-ins read and change during one turn. */
export type DocumentState = {
  skill: Skill | undefined;
  skillSource: string | null;
  /** The kind of the chat's existing deliverable, if any. */
  outputKind: string | null;
  outlineApproved: boolean;
  /** The saved or pinned format, used when a save names none. */
  formatId: string | null;
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
      phase: z.enum(['outline', 'draft', 'final']),
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
  };
}

const LOAD_DESCRIPTION =
  'Load the methodology for a deliverable the user asked for (a document, plan or content). Call it before writing the deliverable; a question needs no methodology. Returns the method and the rules for saving.';
const SAVE_DESCRIPTION =
  'Save the deliverable the user asked for as this chat’s document, after load_skill. Call it once with the whole document; it is saved together with your reply. Returns what was saved.';

/** The model's full tool list: the reads plus the built-ins, sorted, so the cached prefix is stable. */
export function agentToolList(
  registry: ToolRegistry,
  catalog: SkillCatalog,
  bounds: OutputBounds,
): ConversationTool[] {
  const { load, save } = schemas(catalog, bounds);
  const builtins = toolDefinitions([
    { name: LOAD_SKILL, description: LOAD_DESCRIPTION, arguments: load },
    { name: SAVE_DOCUMENT, description: SAVE_DESCRIPTION, arguments: save },
  ]).map((tool) => (tool.name === SAVE_DOCUMENT ? { ...tool, stream_input: true } : tool));
  return [...registry.catalog(), ...builtins].toSorted((a, b) => compareText(a.name, b.name));
}

export function isBuiltin(name: string) {
  return name === LOAD_SKILL || name === SAVE_DOCUMENT;
}

/** The method plus the rules for saving it, as `load_skill` returns and a pinned skill is supplied. */
export function methodology(
  catalog: SkillCatalog,
  skill: Skill,
  state: Pick<DocumentState, 'formatId' | 'outlineApproved'>,
  bounds: OutputBounds,
) {
  const current = state.formatId
    ? `; this chat uses ${state.formatId} unless the user asks for another`
    : '';
  const rules = [
    `Save the deliverable with save_document: a title of at most ${bounds.output_title_max_chars} characters and a Markdown body of at most ${bounds.output_body_max_chars} characters.`,
    usesFormats(skill)
      ? `Name its format in format_id, from the content formats in your instructions${current}.`
      : '',
    skill.outlineFirst && !state.outlineApproved
      ? 'Long-form deliverables start as an outline (phase outline) that the user approves before the draft.'
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
  if (state.skill)
    return {
      ok: false,
      text: `This turn already uses the ${state.skill.id} methodology. A different deliverable belongs in a new chat the user starts; suggest it as a next step.`,
    };
  if (state.outputKind && skill.outputKind !== state.outputKind)
    return {
      ok: false,
      text: `This chat's document is a ${state.outputKind}. A ${skill.outputKind} belongs in a new chat the user starts; suggest it as a next step.`,
    };
  state.skill = skill;
  state.skillSource = 'model';
  return { ok: true, text: methodology(catalog, skill, state, bounds) };
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
  const outline = outlineRequired(catalog, skill, format);
  const phase = outline && !state.outlineApproved ? 'outline' : parsed.data.phase;
  const payload = outputSchema(bounds).safeParse({
    ...parsed.data,
    format_id: format,
    phase,
    title: scrubRecordRefs(parsed.data.title),
    body: scrubRecordRefs(parsed.data.body),
  });
  if (!payload.success)
    return {
      ok: false,
      text: `Give a nonblank title of at most ${bounds.output_title_max_chars} characters and a nonblank body of at most ${bounds.output_body_max_chars} characters.`,
    };
  state.staged = payload.data;
  const label = format ? ` in ${formats?.get(format)?.label ?? format} format` : '';
  const approval = phase === 'outline' ? ' The user approves the outline before a draft.' : '';
  return {
    ok: true,
    text: `Staged the ${phase}${label}; it is saved with your reply.${approval} Now reply briefly; do not repeat the document.`,
  };
}
