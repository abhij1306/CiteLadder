import { describe, expect, it } from 'vitest';
import type { Manifest } from '../src/agent/context.ts';
import { policy } from '../src/config.ts';
import { ruleGuidance, withContentRules } from '../src/page-documents/content-rules.ts';

const pkg = (sections: Manifest['package']['sections']): Manifest['package'] => ({
  version: 'content-context-v1',
  brand_block: '',
  target_page_block: '',
  issue_block: '',
  related_site_block: '',
  sections,
  summary: {},
});
const fetched = (pageKind: string | null) => ({
  requested_url: 'https://acme.test/pricing',
  outcome: 'fetched',
  page_kind: pageKind,
});
const gapAction = (ruleId: string): NonNullable<Manifest['action']> => ({
  id: '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  target_label: 'https://acme.test/pricing',
  skill_id: 'content_optimize',
  diagnosis: { what_happened: [{ rule_id: ruleId, title: 'Not cited for pricing' }] },
});

/** The `content_rules` section a turn's context gets: its place, the offered rule ids and the ones not checked. */
function offered(sections: Manifest['package']['sections'], action: Manifest['action'] = null) {
  const supplied = withContentRules(pkg(sections), action).sections;
  const section = supplied.content_rules;
  if (!section || typeof section !== 'object' || Array.isArray(section)) return null;
  const rules = Array.isArray(section.rules) ? section.rules : [];
  return {
    first: Object.keys(supplied)[0],
    ids: rules.map((line) => String(line).split(' ')[0]),
    lines: rules,
    notChecked: section.not_checked,
  };
}

describe('content rule eligibility', () => {
  it('offers a fetched article the page rules, and leaves out what needs other evidence', () => {
    const turn = offered({ fetched_page: fetched('article'), brand: { name: 'Acme' } });
    expect(turn?.first).toBe('content_rules');
    expect(turn?.ids).toContain('ai_answers.self_contained_passages');
    expect(turn?.ids).toContain('natural_voice.puffery');
    // Comparisons only, and coverage needs the page's prompts.
    expect(turn?.ids).not.toContain('ai_answers.balanced_comparison');
    expect(turn?.ids).not.toContain('coverage.cited_angles');
    // Site Health's rules are never offered to the model pass.
    expect(turn?.ids).not.toContain('aeo.answer_first');
    expect(turn?.notChecked).toEqual([
      'search_guidelines.original_value (needs cited_page_text)',
      'search_guidelines.coverage_depth (needs cited_page_text)',
      'search_guidelines.no_scaled_duplicates (needs site_pages)',
      'search_guidelines.factual_accuracy (needs external_retrieval)',
      'proof.supporting_links (needs link_checks)',
      'coverage.cited_angles (needs page_prompts)',
    ]);
    // Each rule reads as one line: its category, strength and severity, what it checks, and how.
    expect(turn?.lines).toContain(
      'natural_voice.rule_of_three [natural_voice, heuristic, low]: Lists of three used out of habit rather than because there are three things. min occurrences: 3. A clarity fix, never a verdict on who wrote it.',
    );
  });

  it('offers coverage with an Action’s content gap or the chat’s chosen prompts', () => {
    const page = { fetched_page: fetched('comparison') };
    expect(offered(page, gapAction('content_gap_improve_page'))?.ids).toContain(
      'coverage.cited_angles',
    );
    expect(offered(page, gapAction('site_link_near_orphan'))?.ids).not.toContain(
      'coverage.cited_angles',
    );
    const prompts = offered({
      ...page,
      target_prompts: {
        topic: 'CRM',
        prompts: ['best crm for startups'],
        unavailable_prompt_count: 0,
      },
    });
    expect(prompts?.ids).toContain('coverage.cited_angles');
    expect(prompts?.ids).toContain('ai_answers.balanced_comparison');
    // A topic whose prompts no longer resolve gives none.
    expect(
      offered({
        ...page,
        target_prompts: { topic: null, prompts: [], unavailable_prompt_count: 2 },
      })?.ids,
    ).not.toContain('coverage.cited_angles');
  });

  it('marks page-type rules not checked when the fetch does not know the page’s kind', () => {
    const turn = offered({ fetched_page: fetched(null) });
    expect(turn?.ids).not.toContain('ai_answers.balanced_comparison');
    expect(turn?.notChecked).toContain('ai_answers.balanced_comparison (needs page_kind)');
  });

  it('lists the Site Health rules failing on the fetched page as findings the model may fix', () => {
    const page = {
      ...fetched('article'),
      failing_checks: [
        { rule_id: 'aeo.answer_first', outcome: 'fail', reason_code: 'answer_not_first' },
        // Not a catalog rule: nothing the page's copy fixes.
        { rule_id: 'technical.https', outcome: 'fail', reason_code: 'http_only' },
      ],
    };
    const section = withContentRules(pkg({ fetched_page: page }), null).sections.content_rules;
    expect(section).toMatchObject({
      site_health_findings: [
        'aeo.answer_first: No answer-first content structure (fail, answer_not_first)',
      ],
    });
    expect(
      withContentRules(pkg({ fetched_page: fetched('article') }), null).sections.content_rules,
    ).toMatchObject({ site_health_findings: [] });
    // Its fix is stored with the Site Health rule's own source and strength.
    expect(ruleGuidance('aeo.answer_first')).toMatchObject({
      category: 'ai_answers',
      guidance: { strength: 'recommendation', source_key: 'ms_ai_answers' },
    });
  });

  it('adds no section to a turn without a fetched page', () => {
    const sections = {
      brand: { name: 'Acme' },
      fetched_page: { ...fetched('article'), outcome: 'failed' },
    };
    expect(withContentRules(pkg(sections), null)).toEqual(pkg(sections));
  });
});

describe('the rule catalog', () => {
  it('stores a rule’s category, source and strength on its suggestion', () => {
    expect(ruleGuidance('search_guidelines.no_keyword_stuffing')).toEqual({
      category: 'search_guidelines',
      guidance: {
        catalog_version: expect.stringMatching(/^content-rules-[0-9a-f]{16}$/u),
        strength: 'requirement',
        source_key: 'g_spam',
        source_label: 'Google Search Central: spam policies',
        source_url: 'https://developers.google.com/search/docs/essentials/spam-policies',
      },
    });
    expect(() => ruleGuidance('clarity.made_up')).toThrow(
      'Rule clarity.made_up is not in the content rule catalog',
    );
  });

  it('names only Site Health rules that exist, and covers every finding the fetch suggests', () => {
    const siteHealth = new Set(policy.site_health.rule_catalog.map((rule) => rule.rule_id));
    const references = policy.content_rules.rules.filter((rule) => rule.layer === 'L0');
    expect(references.filter((rule) => !siteHealth.has(rule.id))).toEqual([]);
    const fieldRules = Object.keys(policy.content_optimization.suggestions.site_health_field_rules);
    expect(fieldRules.filter((id) => !references.some((rule) => rule.id === id))).toEqual([]);
    const ids = policy.content_rules.rules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
