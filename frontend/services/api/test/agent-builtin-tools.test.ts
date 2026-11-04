import { describe, expect, it } from 'vitest';
import {
  agentToolList,
  editDocument,
  loadSkill,
  saveDocument,
  type DocumentState,
  type SavedDocument,
} from '../src/agent/builtin-tools.ts';
import type { SkillCatalog } from '../src/agent/contracts.ts';
import { ToolRegistry } from '../src/agent/tools.ts';
import { z } from 'zod';
import { catalog as baseCatalog } from './agent-support.ts';

const bounds = { output_title_max_chars: 20, output_body_max_chars: 200 };
const catalog: SkillCatalog = {
  ...baseCatalog,
  skills: new Map([
    ...baseCatalog.skills,
    [
      'refresh',
      {
        id: 'refresh',
        description: 'Refresh content.',
        version: 1,
        outputKind: 'content',
        body: 'Refresh it.',
      },
    ],
  ]),
  formats: new Map([
    ['article', { id: 'article', label: 'Article', body: 'Write an article.' }],
    ['faq', { id: 'faq', label: 'FAQ', body: 'Write an FAQ.' }],
  ]),
};
function state(overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    skill: undefined,
    skillSource: null,
    formatId: null,
    documents: [],
    staged: new Map(),
    ...overrides,
  };
}
const saved = (overrides: Partial<SavedDocument> = {}): SavedDocument => ({
  number: 1,
  kind: 'content',
  skillId: 'content',
  formatId: 'faq',
  title: 'Kids shoes',
  body: 'Intro.\n\nSizes run small.\n\nShop now.',
  ...overrides,
});
const content = () => catalog.skills.get('content');
const plan = () => catalog.skills.get('plan');

describe('Agent built-in tools', () => {
  it('loads any methodology, whatever kind the chat’s documents are', () => {
    const turn = state({ documents: [saved()] });
    const loaded = loadSkill(catalog, turn, { skill_id: 'content' }, bounds);
    expect(loaded.ok).toBe(true);
    expect(loaded.text).toContain('Write requested content.');
    expect(loadSkill(catalog, turn, { skill_id: 'plan' }, bounds).ok).toBe(true);
    expect(turn.skill?.id).toBe('plan');
    expect(loadSkill(catalog, state(), { skill: 'plan' }, bounds).text).toMatch(
      /^Invalid arguments: skill_id: /u,
    );
  });

  it('stages a new numbered document only after a methodology', () => {
    const turn = state({ documents: [saved()] });
    const draft = { title: 'Guide', body: 'Body', format_id: 'article' };
    expect(saveDocument(catalog, turn, draft, bounds)).toEqual({
      ok: false,
      text: 'Load the methodology with load_skill first, then save the document.',
    });
    loadSkill(catalog, turn, { skill_id: 'content' }, bounds);
    expect(saveDocument(catalog, turn, draft, bounds)).toEqual({
      ok: true,
      document: 2,
      text: 'Document 2: staged as a new document in Article format; it is saved with your reply. Now reply briefly; do not repeat the document.',
    });
    expect(turn.staged.get(2)).toEqual({
      kind: 'content',
      skillId: 'content',
      payload: { title: 'Guide', body: 'Body', format_id: 'article' },
    });
    // A second new document in the same turn takes the next number.
    expect(saveDocument(catalog, turn, { ...draft, title: 'FAQ' }, bounds).document).toBe(3);
  });

  it('replaces a document of the loaded kind, once per step, and refuses another kind', () => {
    const turn = state({ skill: content(), documents: [saved()] });
    const replaced = saveDocument(catalog, turn, { document: 1, title: 'New', body: 'B' }, bounds);
    expect(replaced).toMatchObject({ ok: true, document: 1 });
    // The document's format applies when the save names none.
    expect(turn.staged.get(1)?.payload).toMatchObject({ title: 'New', format_id: 'faq' });
    expect(
      saveDocument(catalog, turn, { document: 1, title: 'Again', body: 'B' }, bounds, new Set([1])),
    ).toEqual({
      ok: false,
      text: 'Save Document 1 once per step. The first save in this step was kept.',
    });
    const planning = state({ skill: plan(), documents: [saved()] });
    expect(saveDocument(catalog, planning, { document: 1, title: 'P', body: 'B' }, bounds)).toEqual(
      {
        ok: false,
        text: 'Document 1 is a “content” document and this methodology writes “plan”. Omit document to save this as a new document, or load a “content” methodology to replace it.',
      },
    );
    expect(saveDocument(catalog, planning, { document: 4, title: 'P', body: 'B' }, bounds)).toEqual(
      { ok: false, text: 'This chat has no Document 4. Use one of: Document 1.' },
    );
    expect(planning.staged.size).toBe(0);
  });

  it('refuses a missing format and an oversized document with how to fix them', () => {
    const turn = state({ skill: content() });
    expect(saveDocument(catalog, turn, { title: 'T', body: 'B' }, bounds)).toEqual({
      ok: false,
      text: 'Set format_id to one of: article, faq.',
    });
    // The chat's pinned format applies when a new document names none.
    const continuing = state({ skill: content(), formatId: 'faq' });
    saveDocument(catalog, continuing, { title: 'T', body: 'B' }, bounds);
    expect(continuing.staged.get(1)?.payload).toMatchObject({ format_id: 'faq' });
    expect(
      saveDocument(catalog, turn, { title: 'T', body: 'x'.repeat(201), format_id: 'faq' }, bounds),
    ).toEqual({
      ok: false,
      text: 'Give a nonblank title of at most 20 characters and a nonblank body of at most 200 characters.',
    });
    expect(turn.staged.size).toBe(0);
  });

  it('edits the named document with exact, unique replacements, all or none', () => {
    const turn = state({ documents: [saved()] });
    // With one document the number may be left out, and no methodology is needed.
    expect(
      editDocument(
        catalog,
        turn,
        {
          edits: [
            { old_string: 'Sizes run small.', new_string: 'Sizes run true to size.' },
            { old_string: 'Shop now.', new_string: '' },
          ],
          title: 'Kids school shoes',
        },
        bounds,
      ),
    ).toEqual({
      ok: true,
      document: 1,
      text: 'Document 1: applied 2 edits in FAQ format; it is saved with your reply. Now reply briefly; do not repeat the document.',
    });
    expect(turn.staged.get(1)).toEqual({
      kind: 'content',
      skillId: 'content',
      payload: {
        title: 'Kids school shoes',
        body: 'Intro.\n\nSizes run true to size.',
        format_id: 'faq',
        target_kind: null,
        target: null,
      },
    });
    // A later edit in the same turn changes the staged text, not the saved one.
    editDocument(catalog, turn, { edits: [{ old_string: 'Intro.', new_string: 'Hi.' }] }, bounds);
    expect(turn.staged.get(1)?.payload.body).toBe('Hi.\n\nSizes run true to size.');

    const two = state({
      documents: [saved(), saved({ number: 2, kind: 'plan', skillId: 'plan', body: 'a b a' })],
    });
    expect(
      editDocument(catalog, two, { edits: [{ old_string: 'Intro.', new_string: 'x' }] }, bounds),
    ).toEqual({
      ok: false,
      text: 'Set document to the number of the document to change: one of Document 1, Document 2.',
    });
    expect(
      editDocument(
        catalog,
        two,
        { document: 2, edits: [{ old_string: 'a', new_string: 'c' }] },
        bounds,
      ),
    ).toEqual({
      ok: false,
      text: 'old_string appears more than once. Include more surrounding text so it matches exactly once. No edits were applied.',
    });
    expect(
      editDocument(
        catalog,
        two,
        {
          document: 2,
          edits: [
            { old_string: 'a b', new_string: 'x' },
            { old_string: 'missing', new_string: 'y' },
          ],
        },
        bounds,
      ),
    ).toEqual({
      ok: false,
      text: 'Edit 2: old_string is not in the current document. Copy it exactly, including whitespace and Markdown. No edits were applied.',
    });
    expect(two.staged.size).toBe(0);
    expect(editDocument(catalog, state(), { edits: [] }, bounds).text).toBe(
      'This chat has no documents yet. Write one with save_document.',
    );
  });

  it('offers reads and built-ins sorted by name, streaming only the whole document', () => {
    const registry = new ToolRegistry('v', [
      {
        name: 'read_zeta',
        description: 'Z.',
        arguments: z.strictObject({ limit: z.number().int().nullish() }),
        read: () => Promise.reject(new Error('not called')),
      },
      {
        name: 'fetch',
        description: 'F.',
        arguments: z.strictObject({ id: z.string() }),
        read: () => Promise.reject(new Error('not called')),
      },
    ]);
    const tools = agentToolList(registry, catalog, bounds);
    expect(tools.map((tool) => [tool.name, tool.stream_input ?? false])).toEqual([
      ['edit_document', false],
      ['fetch', false],
      ['load_skill', false],
      ['read_zeta', false],
      ['save_document', true],
    ]);
    // The provider checks the same input schema the tool parses, without null branches.
    expect(tools[3]!.input_schema).toEqual({
      type: 'object',
      properties: { limit: { type: 'integer' } },
      additionalProperties: false,
    });
  });
});
