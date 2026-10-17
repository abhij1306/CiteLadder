import { describe, expect, it } from 'vitest';

import type { Reading, ReadingPresence } from '../src/source-pages/reading.ts';
import { pageStanding } from '../src/visibility/page-standing.ts';

const reading: Reading = {
  id: 'reading',
  source_page_id: 'page',
  fetched_text: '2026-10-01 00:00:00',
  extracted_chars: 4200,
  page_facts: {},
  evidence_passages: [],
};

function presence(entityKind: string, state: string): ReadingPresence {
  return {
    snapshot_id: reading.id,
    entity_kind: entityKind,
    entity_name: entityKind === 'brand' ? 'Acme' : 'Globex',
    presence: state,
    match_method: state === 'present' ? 'exact_alias' : 'none',
    match_count: state === 'present' ? 1 : 0,
    roster_version: 'roster',
    passage_refs: [],
  };
}

const editorial = { source_class: 'editorial_third_party', inspection_state: 'inspected' };
const rivalWithoutYou = [presence('brand', 'not_detected'), presence('competitor', 'present')];

describe('where you stand on a cited page', () => {
  it('calls a read page with rivals and without you a gap', () => {
    expect(pageStanding(editorial, reading, rivalWithoutYou)).toBe('gap');
  });

  it('never judges a page nobody read, and says why it was not read', () => {
    expect(pageStanding(editorial, undefined, [])).toBe('not_read');
    expect(pageStanding({ ...editorial, inspection_state: 'blocked' }, undefined, [])).toBe(
      'blocked',
    );
    expect(pageStanding({ ...editorial, inspection_state: 'failed' }, undefined, [])).toBe(
      'unreadable',
    );
  });

  it("does not offer your own or a competitor's page as somewhere to be listed", () => {
    expect(
      pageStanding({ ...editorial, source_class: 'brand_owned' }, reading, rivalWithoutYou),
    ).toBe('yours');
    expect(
      pageStanding({ ...editorial, source_class: 'competitor_owned' }, reading, rivalWithoutYou),
    ).toBe('competitor');
  });

  it('reports you listed once your name is on the page, and read when no rival is', () => {
    const listed = [presence('brand', 'present'), presence('competitor', 'present')];
    expect(pageStanding(editorial, reading, listed)).toBe('listed');
    expect(pageStanding(editorial, reading, [presence('brand', 'not_detected')])).toBe('read');
  });
});
