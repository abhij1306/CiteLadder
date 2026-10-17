import { describe, expect, it } from 'vitest';
import {
  agentToolList,
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
  formats: new Map([
    ['article', { id: 'article', label: 'Article', body: 'Write an article.', longForm: true }],
    ['faq', { id: 'faq', label: 'FAQ', body: 'Write an FAQ.', longForm: false }],
  ]),
};
function state(overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    skill: undefined,
    skillSource: null,
    outputKind: null,
    outlineApproved: false,
    formatId: null,
    staged: null,
    ...overrides,
  };
}

describe('Agent built-in tools', () => {
  it('loads one methodology per turn and keeps a chat to its deliverable kind', () => {
    const turn = state();
    const loaded = loadSkill(catalog, turn, { skill_id: 'content' }, bounds);
    expect(loaded.ok).toBe(true);
    expect(loaded.text).toContain('Write requested content.');
    expect(turn.skill?.id).toBe('content');
    expect(loadSkill(catalog, turn, { skill_id: 'plan' }, bounds)).toEqual({
      ok: false,
      text: 'This turn already uses the content methodology. A different deliverable belongs in a new chat the user starts; suggest it as a next step.',
    });
    expect(
      loadSkill(catalog, state({ outputKind: 'content' }), { skill_id: 'plan' }, bounds),
    ).toEqual({
      ok: false,
      text: "This chat's document is a content. A plan belongs in a new chat the user starts; suggest it as a next step.",
    });
    expect(loadSkill(catalog, state(), { skill: 'plan' }, bounds).text).toMatch(
      /^Invalid arguments: skill_id: /u,
    );
  });

  it('stages a document only after a methodology, forcing an unapproved long form to outline', () => {
    const turn = state();
    const draft = { title: 'Guide', body: 'Body', phase: 'draft', format_id: 'article' };
    expect(saveDocument(catalog, turn, draft, bounds)).toEqual({
      ok: false,
      text: 'Load the methodology with load_skill first, then save the document.',
    });
    loadSkill(catalog, turn, { skill_id: 'content' }, bounds);
    const saved = saveDocument(catalog, turn, draft, bounds);
    expect(saved).toEqual({
      ok: true,
      text: 'Staged the outline in Article format; it is saved with your reply. The user approves the outline before a draft. Now reply briefly; do not repeat the document.',
    });
    expect(turn.staged).toEqual({ ...draft, phase: 'outline' });
    // A short format drafts directly; an approved outline lets a long form draft.
    const short = state({ skill: catalog.skills.get('content') });
    saveDocument(catalog, short, { ...draft, format_id: 'faq' }, bounds);
    expect(short.staged?.phase).toBe('draft');
    const approved = state({ skill: catalog.skills.get('content'), outlineApproved: true });
    saveDocument(catalog, approved, draft, bounds);
    expect(approved.staged?.phase).toBe('draft');
  });

  it('refuses a missing format and an oversized document with how to fix them', () => {
    const turn = state({ skill: catalog.skills.get('content') });
    expect(saveDocument(catalog, turn, { title: 'T', body: 'B', phase: 'draft' }, bounds)).toEqual({
      ok: false,
      text: 'Set format_id to one of: article, faq.',
    });
    // The chat's saved format applies when a save names none.
    const continuing = state({ skill: catalog.skills.get('content'), formatId: 'faq' });
    saveDocument(catalog, continuing, { title: 'T', body: 'B', phase: 'final' }, bounds);
    expect(continuing.staged).toMatchObject({ format_id: 'faq', phase: 'final' });
    expect(
      saveDocument(
        catalog,
        turn,
        { title: 'T', body: 'x'.repeat(201), phase: 'draft', format_id: 'faq' },
        bounds,
      ),
    ).toEqual({
      ok: false,
      text: 'Give a nonblank title of at most 20 characters and a nonblank body of at most 200 characters.',
    });
    expect(turn.staged).toBeNull();
  });

  it('offers reads and built-ins sorted by name, streaming only the document', () => {
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
      ['fetch', false],
      ['load_skill', false],
      ['read_zeta', false],
      ['save_document', true],
    ]);
    // The provider checks the same input schema the tool parses, without null branches.
    expect(tools[2]!.input_schema).toEqual({
      type: 'object',
      properties: { limit: { type: 'integer' } },
      additionalProperties: false,
    });
  });
});
