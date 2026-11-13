import type { AgentSuggestion, AgentSuggestionsPage } from '@/lib/api/agent';

import { NOW, OUTPUT, PROJECT, REV1, pageChatPhases, revision } from './agent-chat-fixture';

/**
 * A page chat on revision `number` of the page at https://acme.test/pricing,
 * its fetch done with one failing page check, as the chat read returns it.
 */
export function pageChat(
  body: string,
  { revisionId = REV1, number = 1, projectId = PROJECT, actionId = null as string | null } = {},
) {
  const { answered } = pageChatPhases('Here is what to change.');
  return {
    ...answered,
    chat: { ...answered.chat, project_id: projectId, action_id: actionId },
    page_fetch: {
      status: 'done',
      outcome: 'fetched',
      fetched_at: NOW,
      checks: [
        {
          rule_id: 'meta_description_missing',
          label: 'Missing meta description',
          severity: 'medium',
          outcome: 'missing',
          failing: true,
        },
      ],
    },
    outputs: [
      {
        ...answered.outputs[0]!,
        action_id: actionId,
        target_label: 'https://acme.test/pricing',
        latest_revision: {
          ...revision(revisionId, number, 'user', body),
          author: number === 1 ? 'fetch' : 'user',
          title: 'Pricing',
          fields: { title: 'Pricing | Acme', meta_description: '', json_ld: '' },
        },
      },
    ],
  };
}

/** A body suggestion on `exact` in `body`, open and ready unless the overrides say otherwise. */
export function spanSuggestion(
  id: string,
  body: string,
  exact: string,
  overrides: Partial<AgentSuggestion> = {},
): AgentSuggestion {
  const start = body.indexOf(exact);
  if (start === -1) throw new Error(`"${exact}" is not in the body`);
  const position = { start, end: start + exact.length };
  return {
    id,
    output_id: OUTPUT,
    revision_id: REV1,
    source: 'model',
    category: 'clarity',
    rule_id: 'clarity.fluent_prose',
    guidance: {
      strength: 'heuristic',
      source_label: 'Aggarwal et al. 2024, GEO (research)',
      source_url: 'https://arxiv.org/abs/2311.09735',
    },
    rationale: `Say "${exact}" more plainly.`,
    anchor: { kind: 'span', position, quote: { exact, prefix: '', suffix: '' } },
    depends_on: [{ kind: 'span' }],
    replacement: `${exact} (clearer)`,
    needs_input: null,
    status: 'open',
    readiness: 'ready',
    position,
    choose_one: false,
    events: [],
    created_at: NOW,
    ...overrides,
  };
}

/** A suggestion for an SEO field of the page. */
export function fieldSuggestion(
  id: string,
  field: 'title' | 'meta_description' | 'json_ld',
  overrides: Partial<AgentSuggestion> = {},
): AgentSuggestion {
  return {
    ...spanSuggestion(id, 'x', 'x'),
    category: 'search_guidelines',
    rule_id: `seo.${field}`,
    rationale: `Rewrite the ${field}.`,
    anchor: { kind: 'field', field, expected: 'Old value' },
    depends_on: [{ kind: 'field', field }],
    replacement: 'New value',
    position: null,
    ...overrides,
  };
}

/** The suggestions read of revision `revisionId`, with counts taken from the items. */
export function suggestionsPage(
  items: readonly AgentSuggestion[],
  revisionId = REV1,
  stale = 0,
): AgentSuggestionsPage {
  const count = (status: AgentSuggestion['status']) =>
    items.filter((item) => item.status === status).length;
  return {
    revision_id: revisionId,
    items: [...items],
    counts: {
      open: count('open'),
      applied: count('applied'),
      dismissed: count('dismissed'),
      stale,
      needs_input: items.filter(
        (item) => item.status === 'open' && item.readiness === 'needs_input',
      ).length,
      by_category: [],
    },
  };
}
