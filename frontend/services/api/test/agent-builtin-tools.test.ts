import { describe, expect, it } from 'vitest';
import {
  agentToolList,
  editDocument,
  loadSkill,
  saveDocument,
  suggestEdits,
  type DocumentState,
  type SavedDocument,
} from '../src/agent/builtin-tools.ts';
import type { SkillCatalog } from '../src/agent/contracts.ts';
import { ToolRegistry } from '../src/agent/tools.ts';
import { offeredRuleIds } from '../src/page-documents/content-rules.ts';
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
    personIds: new Set(),
    pages: new Map(),
    rules: new Set(['ai_answers.precise_terms', 'proof.specific_statistics']),
    suggestions: [],
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
      text: 'Document 2: staged as a new document in Article format; it is saved with your reply, and the app tells the person so. Now reply briefly; do not repeat the document or announce the save.',
    });
    expect(turn.staged.get(2)).toEqual({
      kind: 'content',
      skillId: 'content',
      payload: { title: 'Guide', body: 'Body', format_id: 'article' },
    });
    // A second new document in the same turn takes the next number.
    expect(saveDocument(catalog, turn, { ...draft, title: 'FAQ' }, bounds).document).toBe(3);
  });

  it('keeps the person’s own UUIDs in a staged document and scrubs every other one', () => {
    const own = '6f1d2c3b-4a5e-4f60-9b7c-8d9e0f1a2b3c';
    const internal = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    const turn = state({
      skill: content(),
      documents: [saved({ body: `Form <input id="${own}">` })],
      personIds: new Set([own]),
    });
    editDocument(
      catalog,
      turn,
      { edits: [{ old_string: 'Form', new_string: `Form (${internal})` }] },
      bounds,
    );
    expect(turn.staged.get(1)?.payload.body).toBe(`Form <input id="${own}">`);
    saveDocument(
      catalog,
      turn,
      { title: 'T', body: `<label for="${own}">`, format_id: 'faq' },
      bounds,
    );
    expect(turn.staged.get(2)?.payload.body).toBe(`<label for="${own}">`);
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
      text: 'Document 1: applied 2 edits in FAQ format; it is saved with your reply, and the app tells the person so. Now reply briefly; do not repeat the document or announce the save.',
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

  it('changes a fetched page document only by edits, never a whole save', () => {
    const page = {
      id: 'page_optimize',
      description: 'Improve a fetched page.',
      version: 1,
      outputKind: 'page',
      body: 'Edit the page.',
    };
    const pages: SkillCatalog = { ...catalog, skills: new Map([[page.id, page]]) };
    const fetched = saved({ kind: 'page', skillId: page.id, formatId: null, body: 'Old intro.' });
    const turn = state({ skill: page, documents: [fetched] });
    expect(
      saveDocument(pages, turn, { document: 1, title: 'New', body: 'Whole page' }, bounds),
    ).toEqual({
      ok: false,
      text: 'A page document is the live page CiteLadder fetched; it is never written whole. Change it with edit_document.',
    });
    expect(
      editDocument(
        pages,
        turn,
        { edits: [{ old_string: 'Old intro.', new_string: 'New intro.' }] },
        bounds,
      ),
    ).toMatchObject({ ok: true, document: 1 });
    expect(turn.staged.get(1)?.payload.body).toBe('New intro.');
  });

  describe('suggest_edits', () => {
    const open = '5b2f0d7e-1c3a-4e8b-9f60-2a7d4c1e8b93';
    const pageState = (): DocumentState['pages'] =>
      new Map([
        [
          1,
          {
            fields: { title: 'Kids shoes', meta_description: '', json_ld: '' },
            digest: null,
            known: [
              {
                id: open,
                open: true,
                source: 'site_health',
                ruleId: 'technical.meta_description_present',
                anchor: { kind: 'field', field: 'meta_description', expected: '' },
                position: null,
                replacement: null,
              },
            ],
          },
        ],
      ]);
    const pageTurn = (body = '🎉 Intro.\n\nSizes run small.\n\nShop now.') =>
      state({
        documents: [saved({ kind: 'page', skillId: 'content_optimize', formatId: null, body })],
        pages: pageState(),
      });
    const suggestion = (overrides: Record<string, unknown> = {}) => ({
      old_string: 'Sizes run small.',
      new_string: 'Sizes run half a size small.',
      rule_id: 'ai_answers.precise_terms',
      rationale: 'Say how small.',
      ...overrides,
    });

    it('stages a span at UTF-16 offsets, a field and a question, all with the reply', () => {
      const turn = pageTurn();
      const outcome = suggestEdits(
        catalog,
        turn,
        {
          suggestions: [
            suggestion({ depends_on: ['section'] }),
            {
              field: 'meta_description',
              new_string: 'School shoes for kids, sized by age.',
              rule_id: 'technical.meta_description_present',
              rationale: 'The page has no meta description.',
            },
            {
              old_string: 'Shop now.',
              needs_input: 'How many sizes do you stock?',
              rule_id: 'proof.specific_statistics',
              rationale: 'A count is more convincing.',
            },
          ],
        },
        bounds,
      );
      expect(outcome).toMatchObject({ ok: true, document: 1 });
      expect(
        turn.suggestions.map(({ target, replacement, needsInput, dependsOn, replaces }) => ({
          target,
          replacement,
          needsInput,
          dependsOn,
          replaces,
        })),
      ).toEqual([
        {
          // The emoji before it is two UTF-16 code units.
          target: { kind: 'span', at: { start: 11, end: 27 }, exact: 'Sizes run small.' },
          replacement: 'Sizes run half a size small.',
          needsInput: null,
          dependsOn: ['section'],
          replaces: [],
        },
        {
          target: { kind: 'field', field: 'meta_description' },
          replacement: 'School shoes for kids, sized by age.',
          needsInput: null,
          dependsOn: [],
          // Writing the text for the Site Health finding replaces its advice.
          replaces: [open],
        },
        {
          target: { kind: 'span', at: { start: 29, end: 38 }, exact: 'Shop now.' },
          replacement: null,
          needsInput: 'How many sizes do you stock?',
          dependsOn: [],
          replaces: [],
        },
      ]);
    });

    it('refuses the whole call with how to fix the first broken suggestion', () => {
      const turn = pageTurn('Sizes run small. Sizes run small.');
      const refusal = (items: Record<string, unknown>[]) =>
        suggestEdits(catalog, turn, { suggestions: items }, bounds).text;
      expect(refusal([suggestion()])).toBe(
        'old_string appears more than once. Include more surrounding text so it matches exactly once. No suggestions were staged.',
      );
      const fresh = pageTurn();
      const refused = (items: Record<string, unknown>[]) =>
        suggestEdits(catalog, fresh, { suggestions: items }, bounds).text;
      expect(refused([suggestion(), suggestion({ old_string: 'Missing.' })])).toBe(
        'Suggestion 2: old_string is not in the current page. Copy it exactly, including whitespace and Markdown. No suggestions were staged.',
      );
      expect(refused([suggestion({ needs_input: 'Which sizes?' })])).toBe(
        'A suggestion that needs input has no new_string: ask in needs_input and leave new_string out. No suggestions were staged.',
      );
      expect(refused([suggestion({ replaces: ['0b9c1f2e-3d4a-4b5c-8d6e-7f8091a2b3c4'] })])).toBe(
        'replaces names 0b9c1f2e-3d4a-4b5c-8d6e-7f8091a2b3c4, which is not an open suggestion on this page. Use an id from its suggestion list. No suggestions were staged.',
      );
      expect(
        refused([suggestion({ old_string: null, field: 'title', depends_on: ['section'] })]),
      ).toBe(
        'depends_on section needs old_string; for a field or the whole page use body. No suggestions were staged.',
      );
      expect(fresh.suggestions).toEqual([]);
      // Only a page document takes suggestions.
      expect(
        suggestEdits(
          catalog,
          state({ documents: [saved()] }),
          { suggestions: [suggestion()] },
          bounds,
        ).text,
      ).toBe(
        'Suggestions are for a page document, and this chat has none. Change other documents with edit_document.',
      );
    });

    it('accepts only a rule the turn offers, or the rule of a Site Health finding open on the page', () => {
      const refused = (overrides: Record<string, unknown>, turn = pageTurn()) =>
        suggestEdits(catalog, turn, { suggestions: [suggestion(overrides)] }, bounds).text;
      // A catalog rule whose evidence the turn lacks is not offered.
      expect(refused({ rule_id: 'coverage.cited_angles' })).toBe(
        'rule_id coverage.cited_angles is not a content rule offered for this page. Use one from the content_rules section: ai_answers.precise_terms, proof.specific_statistics. No suggestions were staged.',
      );
      expect(refused({ rule_id: 'clarity.made_up' })).toBe(
        'rule_id clarity.made_up is not a content rule offered for this page. Use one from the content_rules section: ai_answers.precise_terms, proof.specific_statistics. No suggestions were staged.',
      );
      // Site Health raises its own rules; the model only writes the fix for one failing on the page.
      expect(refused({ rule_id: 'aeo.answer_first' })).toBe(
        'aeo.answer_first is a Site Health rule that is not failing on this page; Site Health raises it, not you. Write fixes only for the site_health_findings in content_rules. No suggestions were staged.',
      );
      expect(
        refused(
          { rule_id: 'ai_answers.precise_terms' },
          state({ ...pageTurn(), rules: new Set() }),
        ),
      ).toBe(
        'rule_id ai_answers.precise_terms is not a content rule offered for this page, and none are offered this turn; suggest only text for an open Site Health finding. No suggestions were staged.',
      );
      // The open meta description finding takes its text even when no rule is offered.
      const bare = state({ ...pageTurn(), rules: new Set() });
      const finding = suggestEdits(
        catalog,
        bare,
        {
          suggestions: [
            {
              field: 'meta_description',
              new_string: 'School shoes for kids.',
              rule_id: 'technical.meta_description_present',
              rationale: 'The page has no meta description.',
            },
          ],
        },
        bounds,
      );
      expect(finding.ok).toBe(true);
      expect(bare.suggestions.map((item) => [item.ruleId, item.replaces])).toEqual([
        ['technical.meta_description_present', [open]],
      ]);
    });

    it('takes the fix for a Site Health rule only while the fetched page fails it', () => {
      const fetchedPage = (outcome: string) => ({
        outcome: 'fetched',
        page_kind: 'article',
        failing_checks:
          outcome === 'fail'
            ? [{ rule_id: 'aeo.answer_first', outcome, reason_code: 'answer_not_first' }]
            : [],
      });
      const answerFirst = (outcome: string) => {
        const turn = state({
          ...pageTurn(),
          rules: offeredRuleIds({ sections: { fetched_page: fetchedPage(outcome) }, action: null }),
        });
        const result = suggestEdits(
          catalog,
          turn,
          {
            suggestions: [
              suggestion({
                old_string: 'Sizes run small.',
                new_string: 'Sizes run half a size small, so order one up.',
                rule_id: 'aeo.answer_first',
              }),
            ],
          },
          bounds,
        );
        return { text: result.text, staged: turn.suggestions.map((item) => item.ruleId) };
      };
      expect(answerFirst('fail').staged).toEqual(['aeo.answer_first']);
      expect(answerFirst('pass')).toEqual({
        text: 'aeo.answer_first is a Site Health rule that is not failing on this page; Site Health raises it, not you. Write fixes only for the site_health_findings in content_rules. No suggestions were staged.',
        staged: [],
      });
    });

    it('moves staged suggestions through a later edit and drops the one it changed', () => {
      const turn = pageTurn('Intro.\n\nSizes run small.\n\nShop now.');
      suggestEdits(
        catalog,
        turn,
        {
          suggestions: [
            suggestion(),
            suggestion({ old_string: 'Shop now.', new_string: 'Shop the range.' }),
          ],
        },
        bounds,
      );
      const edited = editDocument(
        catalog,
        turn,
        {
          edits: [
            { old_string: 'Intro.', new_string: 'A longer intro.' },
            { old_string: 'Shop now.', new_string: 'Buy.' },
          ],
        },
        bounds,
      );
      expect(edited.text).toContain(
        'The edit changed the text of one suggestion staged earlier in this turn, so it was dropped; suggest it again if it still applies.',
      );
      expect(turn.suggestions.map((item) => item.target)).toEqual([
        { kind: 'span', at: { start: 17, end: 33 }, exact: 'Sizes run small.' },
      ]);
    });
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
      ['suggest_edits', false],
    ]);
    // The provider checks the same input schema the tool parses, without null branches.
    expect(tools[3]!.input_schema).toEqual({
      type: 'object',
      properties: { limit: { type: 'integer' } },
      additionalProperties: false,
    });
  });
});
