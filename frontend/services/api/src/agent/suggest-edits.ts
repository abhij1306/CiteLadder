/**
 * The parts of the `suggest_edits` built-in that are about suggestions rather
 * than the turn: what the model may name, how one call's suggestion is checked
 * against the page as the turn holds it, how staged suggestions follow the
 * turn's own edits, and how they are stored with the reply (F14). The server
 * resolves `old_string` to a span with its position and quote, and a field to
 * its current value, once; nothing reads `old_string` again.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { agentPageFieldsSchema } from '@citeladder/contracts/agent';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { bodyChanges, mapSpan, sectionOf, type Span } from '../page-documents/anchors.ts';
import { isSiteHealthRule } from '../page-documents/content-rules.ts';
import { documentBoard, turnDigest } from '../page-documents/suggestion-views.ts';
import {
  appendEvent,
  insertSuggestion,
  loadSuggestions,
  statusOf,
  type Anchor,
  type Dependency,
  type PageField,
  type RevisionText,
} from '../page-documents/suggestions.ts';
import { agentPolicy, type Chat } from './contracts.ts';
import type { PageFields } from './outputs.ts';

const p = policy.content_optimization.suggestions;
const FIELDS = ['title', 'meta_description', 'json_ld'] as const satisfies readonly PageField[];
const DEPENDS = ['section', 'body', ...FIELDS] as const;

/** One suggestion as the model writes it. */
export const suggestionInputSchema = z.strictObject({
  old_string: z
    .string()
    .min(1)
    .nullish()
    .describe(
      'Exact text from the page body, matching once. Omit it for an SEO field or the whole page.',
    ),
  field: z
    .enum(FIELDS)
    .nullish()
    .describe('The SEO field this suggestion replaces, instead of old_string.'),
  new_string: z
    .string()
    .nullish()
    .describe(
      'The replacement text. Omit it when the change needs a fact from the person (ask in needs_input) or is advice only.',
    ),
  needs_input: z
    .string()
    .nullish()
    .describe(
      'The one question to ask when the change needs a fact you do not have; new_string is then omitted.',
    ),
  rule_id: z
    .string()
    .describe(
      'The rule it applies: a rule_id from the content_rules context section, or the rule of a Site Health finding open in the page’s suggestion list. The rule sets its category.',
    ),
  rationale: z.string().describe('Why, in one or two plain sentences the person reads.'),
  depends_on: z
    .array(z.enum(DEPENDS))
    .nullish()
    .describe(
      'What else the judgement read: its section (needs old_string), the whole body, or an SEO field. A change there makes it stale.',
    ),
  replaces: z
    .array(z.uuid())
    .nullish()
    .describe(
      'Ids of open suggestions on this page that this one supersedes, such as one that needed input you now have.',
    ),
});
type SuggestionInput = z.infer<typeof suggestionInputSchema>;

/** A suggestion already stored for a page document, as the turn read it. */
type KnownSuggestion = {
  id: string;
  open: boolean;
  source: string;
  ruleId: string;
  anchor: Anchor;
  position: Span | null;
  replacement: string | null;
};
/** A page document's SEO fields, its suggestions, and the list the model is shown. */
export type PageState = { fields: PageFields; known: KnownSuggestion[]; digest: string | null };
/** A suggestion this turn staged; its span is in the document's body as the turn now holds it. */
export type StagedSuggestion = {
  id: string;
  document: number;
  target:
    | { kind: 'span'; at: Span; exact: string }
    | { kind: 'field'; field: PageField }
    | { kind: 'page' };
  dependsOn: (typeof DEPENDS)[number][];
  replacement: string | null;
  needsInput: string | null;
  ruleId: string;
  rationale: string;
  replaces: string[];
};
/** What one suggestion is checked against: the page as the turn holds it and the rules the turn offers. */
type Page = {
  number: number;
  body: string;
  state: PageState;
  rules: ReadonlySet<string>;
  staged: readonly StagedSuggestion[];
};
type Checked = { ok: true; suggestion: StagedSuggestion } | { ok: false; text: string };

const refuse = (text: string): Checked => ({ ok: false, text });
const blank = (text: string | null | undefined) => !text?.trim();

/** The body span old_string names, or why it names none. */
function spanOf(body: string, oldString: string): { at: Span } | { text: string } {
  const start = body.indexOf(oldString);
  if (start < 0)
    return {
      text: 'old_string is not in the current page. Copy it exactly, including whitespace and Markdown.',
    };
  if (body.includes(oldString, start + 1))
    return {
      text: 'old_string appears more than once. Include more surrounding text so it matches exactly once.',
    };
  return { at: { start, end: start + oldString.length } };
}

/** The text a suggestion's new_string would replace, and how long that replacement may be. */
function targetOf(page: Page, input: SuggestionInput) {
  if (input.old_string && input.field) return { text: 'Give old_string or field, not both.' };
  if (input.field)
    return {
      target: { kind: 'field' as const, field: input.field },
      current: page.state.fields[input.field],
      max: p.field_max_chars[input.field],
    };
  if (!input.old_string) return { target: { kind: 'page' as const }, current: null, max: 0 };
  const span = spanOf(page.body, input.old_string);
  if ('text' in span) return span;
  return {
    target: { kind: 'span' as const, at: span.at, exact: input.old_string },
    current: input.old_string,
    max: p.replacement_max_chars,
  };
}

type Texts = { input: SuggestionInput; current: string | null; max: number };
/** Each way the texts the model wrote cannot be stored, with how to fix it, checked in order. */
const TEXT_RULES: readonly [(texts: Texts) => boolean, (texts: Texts) => string][] = [
  [
    ({ input }) => input.new_string != null && input.needs_input != null,
    () =>
      'A suggestion that needs input has no new_string: ask in needs_input and leave new_string out.',
  ],
  [
    ({ input, current }) => input.new_string != null && current === null,
    () =>
      'A suggestion on the whole page has no new_string; name old_string or a field to replace text.',
  ],
  [
    ({ input, current }) => input.new_string != null && input.new_string === current,
    () => 'new_string is the same as the current text. Suggest a change or leave it out.',
  ],
  [
    ({ input, max }) => (input.new_string?.length ?? 0) > max,
    ({ max }) =>
      `new_string is longer than ${max} characters. Suggest a smaller change, or ask in needs_input.`,
  ],
  [
    ({ input }) =>
      input.needs_input != null &&
      (blank(input.needs_input) || input.needs_input.length > p.needs_input_max_chars),
    () => `needs_input is one nonblank question of at most ${p.needs_input_max_chars} characters.`,
  ],
  [
    ({ input }) => blank(input.rationale) || input.rationale.length > p.rationale_max_chars,
    () => `Give a nonblank rationale of at most ${p.rationale_max_chars} characters.`,
  ],
];
/** Why the texts the model wrote cannot be stored, or null. */
function textProblem(texts: Texts) {
  const broken = TEXT_RULES.find(([fails]) => fails(texts));
  return broken ? broken[1](texts) : null;
}

/**
 * Why the rule cannot be applied this turn, or null: a suggestion applies a
 * content rule the turn's context offers, writes the fix for a Site Health
 * rule failing on the fetched page (also offered), or writes the text for a
 * Site Health suggestion open on the page (the same rule). The model pass never
 * raises a Site Health rule that is passing or absent.
 */
function ruleProblem(page: Page, ruleId: string) {
  if (page.rules.has(ruleId)) return null;
  const finding = page.state.known.some(
    (known) => known.open && known.source === 'site_health' && known.ruleId === ruleId,
  );
  if (finding) return null;
  if (isSiteHealthRule(ruleId))
    return `${ruleId} is a Site Health rule that is not failing on this page; Site Health raises it, not you. Write fixes only for the site_health_findings in content_rules.`;
  const offered = [...page.rules];
  return offered.length
    ? `rule_id ${ruleId} is not a content rule offered for this page. Use one from the content_rules section: ${offered.join(', ')}.`
    : `rule_id ${ruleId} is not a content rule offered for this page, and none are offered this turn; suggest only text for an open Site Health finding.`;
}

/** Why the open suggestions it names cannot be replaced, or null. */
function replacesProblem(page: Page, ids: readonly string[]) {
  const open = new Set(page.state.known.filter((known) => known.open).map((known) => known.id));
  const unknown = ids.find((id) => !open.has(id));
  return unknown
    ? `replaces names ${unknown}, which is not an open suggestion on this page. Use an id from its suggestion list.`
    : null;
}

/** A target as one comparable key: the span where it is now, the field, or the page. */
function targetKey(target: StagedSuggestion['target']) {
  if (target.kind === 'span') return `span:${target.at.start}:${target.at.end}`;
  return target.kind === 'field' ? `field:${target.field}` : 'page';
}
function knownKey(known: KnownSuggestion) {
  if (known.anchor.kind === 'field') return `field:${known.anchor.field}`;
  if (known.anchor.kind === 'page') return 'page';
  return known.position ? `span:${known.position.start}:${known.position.end}` : null;
}

/** Whether the suggestion repeats one already open or staged: the same target and the same text. */
function repeats(page: Page, suggestion: StagedSuggestion) {
  const key = targetKey(suggestion.target);
  const same = (target: string | null, replacement: string | null) =>
    target === key && replacement === suggestion.replacement;
  return (
    page.state.known.some((item) => item.open && same(knownKey(item), item.replacement)) ||
    page.staged.some((item) => same(targetKey(item.target), item.replacement))
  );
}

/**
 * The open Site Health suggestion a field suggestion writes the text for: the
 * same rule on the same field. Committing the new one closes it.
 */
function attachedTo(page: Page, input: SuggestionInput) {
  return page.state.known
    .filter(
      (known) =>
        known.open &&
        known.source === 'site_health' &&
        known.ruleId === input.rule_id &&
        known.anchor.kind === 'field' &&
        known.anchor.field === input.field,
    )
    .map((known) => known.id);
}

/** Whether applying the replacement would make the body longer than a document may be. */
function overflows(page: Page, target: StagedSuggestion['target'], replacement: string | null) {
  if (target.kind !== 'span' || replacement === null) return false;
  return (
    page.body.length - target.exact.length + replacement.length > agentPolicy.output_body_max_chars
  );
}

/** Checks one suggestion against the page as the turn holds it; `scrub` removes record references from text. */
export function checkSuggestion(
  page: Page,
  input: SuggestionInput,
  scrub: (text: string) => string,
): Checked {
  const unknownRule = ruleProblem(page, input.rule_id);
  if (unknownRule) return refuse(unknownRule);
  const resolved = targetOf(page, input);
  if ('text' in resolved) return refuse(resolved.text);
  const problem = textProblem({ input, current: resolved.current, max: resolved.max });
  if (problem) return refuse(problem);
  const dependsOn = [...new Set(input.depends_on ?? [])];
  if (dependsOn.includes('section') && resolved.target.kind !== 'span')
    return refuse('depends_on section needs old_string; for a field or the whole page use body.');
  const named = replacesProblem(page, input.replaces ?? []);
  if (named) return refuse(named);
  const suggestion = staging(page, input, { target: resolved.target, dependsOn }, scrub);
  if (overflows(page, suggestion.target, suggestion.replacement))
    return refuse(
      'Applying it would make the page longer than a document can be. Suggest a shorter change.',
    );
  if (repeats(page, suggestion)) return refuse('It repeats an open suggestion. Leave it out.');
  return { ok: true, suggestion };
}

/** The staged form of a checked suggestion, its texts scrubbed of record references. */
function staging(
  page: Page,
  input: SuggestionInput,
  resolved: Pick<StagedSuggestion, 'target' | 'dependsOn'>,
  scrub: (text: string) => string,
): StagedSuggestion {
  return {
    id: randomUUID(),
    document: page.number,
    ...resolved,
    replacement: input.new_string == null ? null : scrub(input.new_string),
    needsInput: input.needs_input == null ? null : scrub(input.needs_input.trim()),
    ruleId: input.rule_id,
    rationale: scrub(input.rationale.trim()),
    replaces: [...new Set([...(input.replaces ?? []), ...attachedTo(page, input)])],
  };
}

/**
 * The turn edited a document it had staged suggestions on: each span moves
 * through the edit, and one whose text the edit changed is dropped. Returns
 * how many were dropped.
 */
export function followEdit(
  staged: StagedSuggestion[],
  number: number,
  before: string,
  after: string,
) {
  const changes = bodyChanges(before, after);
  let dropped = 0;
  for (let index = staged.length - 1; index >= 0; index--) {
    const suggestion = staged[index]!;
    if (suggestion.document !== number || suggestion.target.kind !== 'span') continue;
    const at = mapSpan(changes, suggestion.target.at);
    if (at && after.slice(at.start, at.end) === suggestion.target.exact)
      suggestion.target = { ...suggestion.target, at };
    else {
      staged.splice(index, 1);
      dropped++;
    }
  }
  return dropped;
}

/** Each page document's SEO fields, stored suggestions and the list a turn shows the model. */
export async function pageStates(
  db: Database,
  workspaceId: string,
  documents: readonly { number: number; outputId: string; fields: PageFields }[],
) {
  const states = new Map<number, PageState>();
  for (const document of documents) {
    const { entries } = await documentBoard(db, workspaceId, document.outputId);
    states.set(document.number, {
      fields: document.fields,
      digest: turnDigest(entries),
      known: entries.map(({ suggestion, status, position }) => ({
        id: suggestion.row.id,
        open: status === 'open',
        source: suggestion.row.source,
        ruleId: suggestion.row.rule_id,
        anchor: suggestion.anchor,
        position,
        replacement: suggestion.row.replacement,
      })),
    });
  }
  return states;
}

/** A staged suggestion's dependencies as stored, a section resolved in the committed revision. */
function storedDependencies(suggestion: StagedSuggestion, body: string): Dependency[] {
  return suggestion.dependsOn.map((kind): Dependency => {
    if (kind === 'body') return { kind: 'body' };
    if (kind !== 'section') return { kind: 'field', field: kind };
    // A section needs a span; the check refused it for a field or the page.
    const at = suggestion.target.kind === 'span' ? suggestion.target.at : { start: 0, end: 0 };
    return { kind: 'section', ...sectionOf(body, at) };
  });
}

/**
 * Stores the turn's staged suggestions against each document's latest
 * revision, in the reply's transaction, after its documents were saved. The
 * open suggestions they replace go stale.
 */
export async function saveSuggestions(
  db: Database,
  chat: Chat,
  staged: readonly StagedSuggestion[],
  turn: { runId: string; messageId: string; outputs: ReadonlyMap<number, string> },
) {
  for (const [number, outputId] of turn.outputs) {
    const mine = staged.filter((suggestion) => suggestion.document === number);
    if (mine.length) await saveDocumentSuggestions(db, chat, outputId, mine, turn);
  }
}

/** One document's share of {@link saveSuggestions}: stales what it replaces, then stores it. */
async function saveDocumentSuggestions(
  db: Database,
  chat: Chat,
  outputId: string,
  mine: readonly StagedSuggestion[],
  turn: { runId: string; messageId: string },
) {
  const owner = { workspaceId: chat.workspace_id, projectId: chat.project_id };
  const by = { actor: 'agent' as const, runId: turn.runId };
  const revision = await latestRevision(db, chat.workspace_id, outputId);
  const replaced = new Set(mine.flatMap((suggestion) => suggestion.replaces));
  for (const suggestion of await loadSuggestions(db, chat.workspace_id, outputId))
    if (replaced.has(suggestion.row.id) && statusOf(suggestion) === 'open')
      await appendEvent(db, owner, suggestion, { status: 'stale', by, reason: 'replaced' });
  for (const suggestion of mine) {
    const { target } = suggestion;
    if (
      target.kind === 'span' &&
      revision.body.slice(target.at.start, target.at.end) !== target.exact
    )
      throw new TypeError('A staged suggestion does not match its committed revision');
    await insertSuggestion(
      db,
      { ...owner, outputId, revision, by },
      {
        id: suggestion.id,
        anchor: target.kind === 'span' ? { kind: 'span', position: target.at } : target,
        dependsOn: storedDependencies(suggestion, revision.body),
        replacement: suggestion.replacement,
        needsInput: suggestion.needsInput,
        ruleId: suggestion.ruleId,
        rationale: suggestion.rationale,
        source: 'model',
        runId: turn.runId,
        messageId: turn.messageId,
      },
    );
  }
}

const fieldsSchema = agentPageFieldsSchema.nullable();
/** A document's latest revision as the suggestion checks read it. */
async function latestRevision(
  db: Database,
  workspaceId: string,
  outputId: string,
): Promise<RevisionText> {
  const row = await db
    .selectFrom('agent_output_revisions')
    .select(['id', 'number', 'body', 'fields'])
    .where('workspace_id', '=', workspaceId)
    .where('output_id', '=', outputId)
    .orderBy('number', 'desc')
    .limit(1)
    .executeTakeFirstOrThrow();
  return { ...row, fields: fieldsSchema.parse(row.fields) };
}
