import { describe, expect, it } from 'vitest';
import {
  agentToolList,
  editDocument,
  loadSkill,
  saveDocument,
  type DocumentState,
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
    outputKind: null,
    formatId: null,
    document: null,
    staged: null,
    ...overrides,
  };
}
const content = () => catalog.skills.get('content');

describe('Agent built-in tools', () => {
  it('switches methodology within a kind and keeps a chat to its deliverable kind', () => {
    const turn = state();
    const loaded = loadSkill(catalog, turn, { skill_id: 'content' }, bounds);
    expect(loaded.ok).toBe(true);
    expect(loaded.text).toContain('Write requested content.');
    expect(loadSkill(catalog, turn, { skill_id: 'refresh' }, bounds).ok).toBe(true);
    expect(turn.skill?.id).toBe('refresh');
    expect(
      loadSkill(catalog, state({ outputKind: 'content' }), { skill_id: 'plan' }, bounds),
    ).toEqual({
      ok: false,
      text: 'This chat’s document is of kind “content” and this methodology writes “plan”, so it cannot be used here. Answer in your reply instead, or offer to continue in a new chat.',
    });
    expect(loadSkill(catalog, state(), { skill: 'plan' }, bounds).text).toMatch(
      /^Invalid arguments: skill_id: /u,
    );
  });

  it('stages any format as the document only after a methodology', () => {
    const turn = state();
    const draft = { title: 'Guide', body: 'Body', format_id: 'article' };
    expect(saveDocument(catalog, turn, draft, bounds)).toEqual({
      ok: false,
      text: 'Load the methodology with load_skill first, then save the document.',
    });
    loadSkill(catalog, turn, { skill_id: 'content' }, bounds);
    expect(saveDocument(catalog, turn, draft, bounds)).toEqual({
      ok: true,
      text: 'Staged the document in Article format; it is saved with your reply. Now reply briefly; do not repeat the document.',
    });
    expect(turn.staged).toEqual({ title: 'Guide', body: 'Body', format_id: 'article' });
  });

  it('refuses a missing format and an oversized document with how to fix them', () => {
    const turn = state({ skill: content() });
    expect(saveDocument(catalog, turn, { title: 'T', body: 'B' }, bounds)).toEqual({
      ok: false,
      text: 'Set format_id to one of: article, faq.',
    });
    // The chat's saved format applies when a save names none.
    const continuing = state({ skill: content(), formatId: 'faq' });
    saveDocument(catalog, continuing, { title: 'T', body: 'B' }, bounds);
    expect(continuing.staged).toMatchObject({ format_id: 'faq' });
    expect(
      saveDocument(catalog, turn, { title: 'T', body: 'x'.repeat(201), format_id: 'faq' }, bounds),
    ).toEqual({
      ok: false,
      text: 'Give a nonblank title of at most 20 characters and a nonblank body of at most 200 characters.',
    });
    expect(turn.staged).toBeNull();
  });

  it('edits the current document with exact, unique replacements, all or none', () => {
    const turn = state({
      skill: content(),
      formatId: 'faq',
      document: { title: 'Kids shoes', body: 'Intro.\n\nSizes run small.\n\nShop now.' },
    });
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
      text: 'Applied 2 edits in FAQ format; it is saved with your reply. Now reply briefly; do not repeat the document.',
    });
    expect(turn.staged).toEqual({
      title: 'Kids school shoes',
      body: 'Intro.\n\nSizes run true to size.',
      format_id: 'faq',
      target_kind: null,
      target: null,
    });
    // A later edit in the same turn changes the staged text, not the saved one.
    editDocument(catalog, turn, { edits: [{ old_string: 'Intro.', new_string: 'Hi.' }] }, bounds);
    expect(turn.staged?.body).toBe('Hi.\n\nSizes run true to size.');

    const strict = state({ skill: content(), document: { title: 'T', body: 'a b a' } });
    expect(
      editDocument(catalog, strict, { edits: [{ old_string: 'a', new_string: 'c' }] }, bounds),
    ).toEqual({
      ok: false,
      text: 'old_string appears more than once. Include more surrounding text so it matches exactly once. No edits were applied.',
    });
    expect(
      editDocument(
        catalog,
        strict,
        {
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
    expect(strict.staged).toBeNull();
    expect(editDocument(catalog, state({ skill: content() }), { edits: [] }, bounds).text).toBe(
      'This chat has no document yet. Write it with save_document.',
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
