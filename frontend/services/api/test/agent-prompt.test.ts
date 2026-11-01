import { describe, expect, it } from 'vitest';
import { admittedBudget } from '../src/agent/contracts.ts';
import { suppliedManifest } from '../src/agent/context.ts';
import { boundToolData } from '../src/agent/tools.ts';
import { replayed } from '../src/agent/transcript.ts';
import { emptyPackage } from './agent-support.ts';

describe('structurally bounded Agent context and tool results', () => {
  const input = { budget: admittedBudget(10) };
  it('keeps selected issue totals and whole occurrence samples when background exceeds the budget', () => {
    const occurrences = Array.from({ length: 10 }, (_, index) => ({
      site_url_id: `page-${index}`,
      display_url: `https://example.test/${index}`,
      evidence: { descriptors: 'x'.repeat(3000) },
    }));
    const manifest = {
      version: 'agent-context-1',
      refs: {},
      instructions: null,
      action: null,
      mentions: [],
      package: {
        ...emptyPackage,
        sections: {
          brand: { name: 'Example', facts: 'b'.repeat(4000) },
          issue_group: {
            affected_url_count: 94,
            occurrence_count: 94,
            occurrences,
            sample: { supplied_occurrences: 10, total_occurrences: 94, complete: false },
          },
          related_site: [{ body: 'r'.repeat(24000) }],
        },
      },
    };
    const supplied = suppliedManifest(manifest);
    const group = JSON.parse(supplied.text).package.sections.issue_group;
    expect(group.affected_url_count).toBe(94);
    expect(group.occurrences.length).toBeGreaterThan(0);
    expect(group.occurrences.length).toBeLessThan(10);
    expect(group.occurrences).toEqual(occurrences.slice(0, group.occurrences.length));
    expect(group.sample).toEqual({
      supplied_occurrences: group.occurrences.length,
      total_occurrences: 94,
      complete: false,
    });
    expect(manifest.package.sections.issue_group.occurrences).toHaveLength(10);
    expect(supplied.omissions).toContain('package.sections.issue_group.occurrences');
    expect(supplied.text.length).toBeLessThanOrEqual(input.budget.context_package_max_chars);
  });
  it('gives the model the context summary without its record provenance', () => {
    const manifest = {
      version: 'agent-context-1',
      refs: {},
      instructions: null,
      action: null,
      mentions: [],
      package: {
        ...emptyPackage,
        summary: {
          page_count: 2,
          provenance: [{ analysis_id: '58fde15a-53a5-4ffc-b32b-8fd34a67ecd8' }],
        },
      },
    };
    const supplied = suppliedManifest(manifest);
    expect(JSON.parse(supplied.text).package.summary).toEqual({ page_count: 2 });
    expect(manifest.package.summary.provenance).toHaveLength(1);
  });
  it('never presents its own context trimming as crawl coverage, nor record ids', () => {
    const supplied = suppliedManifest({
      version: 'agent-context-1',
      refs: {},
      instructions: null,
      action: null,
      mentions: [],
      package: {
        ...emptyPackage,
        summary: {
          page_count: 10,
          omissions: [
            { reason: 'page_limit', count: 429 },
            { reason: 'character_budget', count: 3 },
          ],
          site_url_ids: ['58fde15a-53a5-4ffc-b32b-8fd34a67ecd8'],
          artifact_ids: ['68fde15a-53a5-4ffc-b32b-8fd34a67ecd8'],
          crawl_urls: ['https://example.test/'],
        },
      },
    });
    expect(JSON.parse(supplied.text).package.summary).toEqual({
      page_count: 10,
      agent_context_pages_omitted: 432,
    });
  });
  it('says a crawl was unavailable rather than leaving a zero page count to read as measured', () => {
    const supplied = suppliedManifest({
      version: 'agent-context-1',
      refs: {},
      instructions: null,
      action: null,
      mentions: [],
      package: {
        ...emptyPackage,
        summary: { page_count: 0, omissions: [{ reason: 'no_usable_crawl' }] },
      },
    });
    expect(JSON.parse(supplied.text).package.summary).toEqual({
      page_count: 0,
      crawl_unavailable: true,
    });
  });
  it('drops oversized company background without trimming the selected issue or page', () => {
    const group = {
      affected_url_count: 94,
      occurrences: [{ site_url_id: 'selected-page', evidence: { observed: true } }],
      sample: { supplied_occurrences: 1, total_occurrences: 94, complete: false },
    };
    const page = { site_url_id: 'selected-page', title: 'Exact selected page' };
    const supplied = suppliedManifest({
      version: 'agent-context-1',
      refs: { issue_group_reference: { site_url_id: 'selected-page' } },
      instructions: null,
      action: null,
      mentions: [],
      package: {
        ...emptyPackage,
        sections: { issue_group: group, target_page: page, brand: { facts: 'x'.repeat(30000) } },
      },
    });
    expect(JSON.parse(supplied.text).package.sections.issue_group).toEqual(group);
    expect(JSON.parse(supplied.text).package.sections.target_page).toEqual(page);
    expect(supplied.omissions).toContain('package.sections.brand');
    expect(supplied.omissions).not.toContain('package.sections.issue_group.occurrences');
  });
  it('retains small evidence families when one family makes the overview oversized', () => {
    const health = { state: 'available', count: 94 };
    const bounded = boundToolData(
      { evidence: { health, opportunities: { items: 'x'.repeat(10000) } } },
      300,
      true,
    );
    expect(JSON.parse(bounded.text)).toEqual({
      data: { evidence: { health } },
      complete: false,
      omitted_sections: ['evidence.opportunities'],
    });
    expect(bounded.omissions).toContainEqual(
      expect.objectContaining({ sections: ['evidence.opportunities'] }),
    );
  });
  it('keeps arbitrary state-bearing projections atomic under size pressure', () => {
    const bounded = boundToolData(
      {
        evidence: { state: { kind: 'historical', explanation: 'x'.repeat(10000) }, count: 94 },
        summary: 'Other available context',
      },
      300,
    );
    expect(JSON.parse(bounded.text)).toEqual({
      data: { summary: 'Other available context' },
      complete: false,
      omitted_sections: ['evidence'],
    });
  });
  it('omits a large diagnosis as one disclosed section', () => {
    const source = '00000000-0000-4000-8000-000000000001';
    const manifest = {
      version: 'agent-context-1',
      refs: {},
      instructions: null,
      mentions: [],
      package: emptyPackage,
      action: {
        id: source,
        target_label: 'Action',
        skill_id: null,
        diagnosis: { what_happened: [{ opportunity_id: source }], bulky: 'x'.repeat(10000) },
      },
    };
    const supplied = suppliedManifest(manifest, 1500);
    expect(JSON.parse(supplied.text).action.diagnosis).toEqual({});
    expect(supplied.omissions).toContain(`action.diagnosis:${source}`);
  });
  it('keeps generic tool envelopes valid and labels whole omitted fields', () => {
    const bounded = boundToolData({ count: 119, details: '😀\\\"'.repeat(10000) }, 500);
    expect(JSON.parse(bounded.text)).toEqual({
      data: { count: 119 },
      complete: false,
      omitted_sections: ['details'],
    });
    expect(bounded.supplied).toBe(true);
    expect(bounded.text.length).toBeLessThanOrEqual(500);
  });
});

describe('replayed chat history', () => {
  const turn = (runId: string, chars: number) => ({
    runId,
    contextHash: '',
    skillId: null,
    messages: [{ role: 'user' as const, content: [{ type: 'text', text: 'x'.repeat(chars) }] }],
  });
  const transcripts = [turn('oldest', 900), turn('middle', 900), turn('newest', 900)];
  const budget = { ...admittedBudget(10), replay_max_chars: 2_000 };
  it('drops the oldest whole turns for chat completions, which cannot compact', () => {
    const { kept, dropped } = replayed(transcripts, 'openai_compatible', budget);
    expect(kept.map((item) => item.runId)).toEqual(['middle', 'newest']);
    expect(dropped).toBe(1);
  });
  it('keeps every turn for Anthropic, whose server-side compaction bounds the chat', () => {
    const { kept, dropped } = replayed(transcripts, 'anthropic', budget);
    expect(kept.map((item) => item.runId)).toEqual(['oldest', 'middle', 'newest']);
    expect(dropped).toBe(0);
  });
});
