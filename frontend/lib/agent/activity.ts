import type { AgentStep } from '@citeladder/contracts/agent';

export function modelStepLabel(status: string): string {
  if (status === 'working') return 'Deciding the next step…';
  if (status === 'processing') return 'Processing the next step…';
  if (status === 'reasoned') return 'Planned the next step';
  if (status === 'failed') return 'Step failed';
  if (status === 'interrupted') return 'Earlier attempt interrupted';
  return 'Step status unknown';
}

type Verb = { running: string; done: string; failed: string };
const VERB = {
  read: { running: 'Reading', done: 'Read', failed: 'Couldn’t read' },
  search: { running: 'Searching', done: 'Searched', failed: 'Couldn’t search' },
  load: { running: 'Loading', done: 'Loaded', failed: 'Couldn’t load' },
  save: { running: 'Saving', done: 'Saved', failed: 'Couldn’t save' },
  replace: { running: 'Replacing', done: 'Replaced', failed: 'Couldn’t replace' },
  edit: { running: 'Editing', done: 'Edited', failed: 'Couldn’t edit' },
  suggest: { running: 'Suggesting', done: 'Suggested', failed: 'Couldn’t suggest' },
  show: { running: 'Placing', done: 'Placed', failed: 'Couldn’t place' },
} as const satisfies Record<string, Verb>;

const TOOL_ACTIVITY: Record<string, { verb: Verb; noun: string }> = {
  load_skill: { verb: VERB.load, noun: 'the method' },
  save_document: { verb: VERB.save, noun: 'a document' },
  edit_document: { verb: VERB.edit, noun: 'a document' },
  suggest_edits: { verb: VERB.suggest, noun: 'changes' },
  propose_declaration: { verb: VERB.suggest, noun: 'marking an Action implemented' },
  show_view: { verb: VERB.show, noun: 'a chart or table' },
  propose_change: { verb: VERB.suggest, noun: 'a change' },
  web_search: { verb: VERB.search, noun: 'the web' },
  search: { verb: VERB.search, noun: 'CiteLadder' },
  fetch: { verb: VERB.read, noun: 'a record' },
  get_project_business_context: { verb: VERB.read, noun: 'the project overview' },
  read_visibility_overview: { verb: VERB.read, noun: 'AI visibility' },
  read_visibility_trends: { verb: VERB.read, noun: 'visibility trends' },
  read_perception: { verb: VERB.read, noun: 'answer perception' },
  read_fact_checks: { verb: VERB.read, noun: 'fact checks' },
  read_ai_ads: { verb: VERB.read, noun: 'ads in AI answers' },
  read_visibility_results: { verb: VERB.read, noun: 'AI answers' },
  read_visibility_sources: { verb: VERB.read, noun: 'cited sources' },
  read_source_url: { verb: VERB.read, noun: 'a cited page' },
  read_prompt_portfolio: { verb: VERB.read, noun: 'prompts' },
  read_prompt_metrics: { verb: VERB.read, noun: 'prompt metrics' },
  read_query_fanouts: { verb: VERB.read, noun: 'query fanouts' },
  read_competitors: { verb: VERB.read, noun: 'competitors' },
  read_seed_queries: { verb: VERB.read, noun: 'seed queries' },
  read_actions: { verb: VERB.read, noun: 'Actions' },
  read_content_differentiation: { verb: VERB.read, noun: 'content comparisons' },
  read_ai_shelf: { verb: VERB.read, noun: 'the AI Shelf' },
  read_site_health: { verb: VERB.read, noun: 'Website' },
  read_site_pages: { verb: VERB.read, noun: 'site pages' },
  read_page_text: { verb: VERB.read, noun: 'page' },
  read_site_links: { verb: VERB.read, noun: 'internal links' },
  read_ai_crawlability: { verb: VERB.read, noun: 'AI crawler access' },
  read_crawl_logs: { verb: VERB.read, noun: 'AI crawler visits' },
  read_ai_traffic_pages: { verb: VERB.read, noun: 'AI traffic by page' },
  read_ai_traffic_url: { verb: VERB.read, noun: 'AI traffic for a page' },
  read_ai_traffic_insights: { verb: VERB.read, noun: 'AI traffic insights' },
  read_ai_referrals: { verb: VERB.read, noun: 'AI referral traffic' },
  read_performance: { verb: VERB.read, noun: 'search performance' },
  read_query_evidence: { verb: VERB.read, noun: 'queries by page' },
  read_demand: { verb: VERB.read, noun: 'search demand' },
  read_integration_status: { verb: VERB.read, noun: 'connected data' },
  read_search_intelligence: { verb: VERB.read, noun: 'keyword research' },
  read_search_dataset: { verb: VERB.read, noun: 'a research dataset' },
};
const OTHER_READ = { verb: VERB.read, noun: 'CiteLadder data' };

type ActivityState = 'running' | 'done' | 'unavailable' | 'failed' | 'unknown';
export type ActivityRow = {
  key: string;
  verb: string;
  noun: string;
  detail: string | null;
  state: ActivityState;
};

const CALL_STATES = new Map<string, ActivityState | null>([
  ['started', 'running'],
  ['completed', 'done'],
  ['unavailable', 'unavailable'],
  ['failed', 'failed'],
  ['refused', null],
]);

function callState(status: string): ActivityState | null {
  const state = CALL_STATES.get(status);
  return state === undefined ? 'unknown' : state;
}

function callRow(
  key: string,
  { tool, status, target }: { tool: string; status: string; target: string | null },
): ActivityRow[] {
  const state = callState(status);
  if (!state) return [];
  const { verb, noun } = TOOL_ACTIVITY[tool] ?? OTHER_READ;
  let outcome = '';
  if (state === 'unavailable') outcome = 'no data yet';
  else if (state === 'unknown') outcome = 'outcome unknown';
  return [
    {
      key,
      verb: state === 'running' || state === 'failed' ? verb[state] : verb.done,
      noun,
      detail: [target, outcome].filter(Boolean).join(' · ') || null,
      state,
    },
  ];
}

export function callStep(call: {
  ordinal: number;
  tool: string | null;
  status: string;
  call_id: string | null;
  target: string | null;
}): AgentStep {
  const { ordinal, tool, status, target } = call;
  if (tool === null) return { kind: 'model', ordinal };
  return { kind: 'tool', ordinal, tool, status, call_id: call.call_id ?? '', target };
}

export function activityLabel(row: Pick<ActivityRow, 'verb' | 'noun'>) {
  return `${row.verb} ${row.noun}`;
}

const DOCUMENT_VERB = { created: VERB.save, replaced: VERB.replace, edited: VERB.edit } as const;

export function activityRows(steps: readonly AgentStep[]): ActivityRow[] {
  return steps.flatMap((step, index): ActivityRow[] => {
    const key = `${step.kind}:${index}`;
    switch (step.kind) {
      case 'model':
        return [];
      case 'skill':
        return callRow(key, { tool: 'load_skill', status: 'completed', target: null });
      case 'suggestion':
        return callRow(key, { tool: 'suggest_edits', status: 'completed', target: null });
      case 'proposal':
        return callRow(key, {
          tool: 'propose_declaration',
          status: 'completed',
          target: step.label,
        });
      case 'change':
        return callRow(key, { tool: 'propose_change', status: 'completed', target: step.label });
      case 'document':
        return [
          {
            key,
            verb: DOCUMENT_VERB[step.action].done,
            noun: `Document ${step.number}`,
            detail: step.title || null,
            state: 'done',
          },
        ];
      case 'search':
        return callRow(key, { tool: 'web_search', status: step.status, target: step.query });
      case 'tool':
        return callRow(key, step);
      default: {
        const _exhaustive: never = step;
        return _exhaustive;
      }
    }
  });
}

function joined(nouns: readonly string[]) {
  const shown = nouns.length > 3 ? [...nouns.slice(0, 2), `${nouns.length - 2} more`] : nouns;
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0];
}

export function activitySummary(rows: readonly ActivityRow[]): string {
  const groups = new Map<string, string[]>();
  for (const { verb, noun } of rows) {
    const nouns = groups.get(verb) ?? [];
    if (!nouns.includes(noun)) nouns.push(noun);
    groups.set(verb, nouns);
  }
  return [...groups]
    .map(([verb, nouns], index) => {
      const lead = index === 0 ? verb : `${verb.charAt(0).toLowerCase()}${verb.slice(1)}`;
      return `${lead} ${joined(nouns)}`;
    })
    .join(' · ');
}
