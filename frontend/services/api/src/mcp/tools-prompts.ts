import { z } from 'zod';
import { ACTION_STATUS_ANY, actionStatusSchema } from '@citeladder/contracts/action-status';
import { actionTreeGroupBySchema } from '@citeladder/contracts/actions';
import { policy } from '../config.ts';
import {
  actionsRead,
  differentiationRead,
  promptPortfolio,
  seedQueriesRead,
  shelfRead,
} from './evidence.ts';
import { competitorsRead } from './evidence-competitors.ts';
import { promptMetricsRead, queryFanoutsRead } from './evidence-prompts.ts';
import { promptCandidates, promptSets } from './evidence-prompt-setup.ts';
import { commerceSetup } from './evidence-commerce.ts';
import { actionGroups, pageActions } from './views-work.ts';
import { McpInputError } from './types.ts';
import {
  optional,
  uuid,
  page,
  run,
  latestRun,
  project,
  engine,
  cohort,
  market_id,
  topic_id,
  prompt_id,
  projectTool,
} from './tool-definitions.ts';

export const promptTools = {
  read_prompt_portfolio: projectTool({
    title: 'Read prompts',
    description:
      'List the prompts the project tracks, so you know what is measured before reading results or changing prompts. Each row has the prompt id, text, topic, intent, buyer stage, cohort (core prompts are scored; comparison prompts name a competitor and are reported separately), status and whether audits measure it now, plus its prompt set and topic_id. topics lists every project topic (id, name, description), including topics with no prompts yet; topics_truncated says the list is partial. Rows come oldest first, in pages; pass next_cursor for more. To find one prompt by its wording use search; to see what engines answered for a prompt use read_visibility_results with its prompt_id. Prompt ids feed the update_prompt_text, update_prompts and launch_audit change kinds. view sets lists every prompt set, empty ones included; view candidates lists suggested prompts waiting for review, with their ids.',
    schema: z.strictObject({
      ...project,
      prompt_set_id: optional(
        uuid.describe(
          'A prompt set id from an earlier row of this tool; omit for every set in the project.',
        ),
      ),
      view: z
        .enum(['prompts', 'sets', 'candidates'])
        .default('prompts')
        .describe('prompts (the default), sets or candidates; each is paged.'),
      cohort: optional(
        z
          .enum(['core', 'comparison'])
          .describe(
            'Keep only scored or only comparison prompts; combines with the other filters.',
          ),
      ),
      intent: optional(
        z
          .enum(policy.prompts.intents)
          .describe('Keep only prompts with this intent; evaluation marks brand prompts.'),
      ),
      active_only: z
        .boolean()
        .default(false)
        .describe(
          'true keeps only prompts audits measure now; false (the default) also lists disabled and archived ones.',
        ),
      ...page,
    }),
    read: (read, args) => {
      switch (args.view) {
        case 'sets':
          return promptSets(read, args);
        case 'candidates':
          return promptCandidates(read, args);
        default:
          return promptPortfolio(read, args);
      }
    },
  }),
  read_prompt_metrics: projectTool({
    title: 'Read prompt metrics',
    description:
      "Find which prompts the brand wins or loses. view list ranks one run's prompts by score, each with its visibility and citation rates, share of voice, average position, win rate, net sentiment, web search share, the brands its answers named and its change against the previous run, paged (pass next_cursor). view history is one prompt's score per run with the Actions implemented along the way; view answers lists that prompt's answers across runs, newest first, with the brands named, your position, whether you were cited and whether the engine searched, each with a citeladder:// id for fetch. Null rates, win rate or sentiment are unavailable or not applicable, never zero. list defaults to the latest completed run; unavailable no_completed_run means none has finished. Use read_prompt_portfolio for the wording and topic of every tracked prompt, and read_visibility_results for every answer of one run.",
    schema: z.strictObject({
      ...project,
      market_id,
      view: z
        .enum(['list', 'history', 'answers'])
        .default('list')
        .describe(
          "list is one run's prompts (the default); history and answers are one prompt across runs and need prompt_id.",
        ),
      prompt_id,
      audit_id: optional(run.describe('With view list: a run id (audit_id); omit for the latest.')),
      baseline_id: optional(
        uuid.describe('With view list: an earlier run id to measure change against.'),
      ),
      engine,
      cohort,
      ...page,
    }),
    read: promptMetricsRead,
  }),
  read_query_fanouts: projectTool({
    title: 'Read query fanouts',
    description:
      "Read the web searches engines ran while answering one run's prompts: each query with how often it ran, its share of every search, its change against the previous comparable run (null when not compared), the engines and prompts behind it, how many of its answers named the brand, and the tracked brands the query itself names (null when the run counted no queries). event_count, distinct_queries and coverage describe the whole run, unaffected by paging. order top ranks by share; rising and falling by change. Pass search to match query text, prompt_id or topic_id to narrow. It defaults to the latest completed run; unavailable no_completed_run means none has finished. Use read_prompt_metrics for the prompts themselves.",
    schema: z.strictObject({
      ...project,
      market_id,
      audit_id: latestRun,
      engine,
      cohort,
      topic_id,
      prompt_id,
      search: optional(z.string().trim().min(1).max(512).describe('Words a query must contain.')),
      order: z
        .enum(['top', 'rising', 'falling'])
        .default('top')
        .describe('top by share (the default); rising or falling by change since the last run.'),
      ...page,
    }),
    read: queryFanoutsRead,
  }),
  read_competitors: projectTool({
    title: 'Read competitors',
    description:
      "Read the competitors. view list is the tracked roster (names, aliases, domains) and the brand's own domains. view focus is one tracked competitor against the brand over a run: how many answers named it, the sources cited where it was named, and the prompts where it was named instead of the brand; it defaults to the latest completed run and takes topic_id. view suggestions lists pending competitor suggestions from audits (a cited domain or a name answers used), with how many prompts and engines raised them; a suggestion is a signal, not a tracked competitor, until the user accepts it (review_competitor_suggestion, or in CiteLadder). Use read_visibility_overview for every brand's rates side by side.",
    schema: z.strictObject({
      ...project,
      view: z
        .enum(['list', 'focus', 'suggestions'])
        .default('list')
        .describe('list is the roster (the default); focus needs name; suggestions are pending.'),
      name: optional(
        z
          .string()
          .trim()
          .min(1)
          .max(255)
          .describe('With view focus: a tracked competitor exactly as view list names it.'),
      ),
      market_id,
      audit_id: optional(
        run.describe('With view focus: a run id (audit_id); omit for the latest.'),
      ),
      engine,
      cohort,
      topic_id,
    }),
    read: competitorsRead,
  }),
  read_seed_queries: projectTool({
    title: 'Read seed queries',
    description:
      "List the searches a prompt generation run could ground its wording on, for each search data source the project has (search_console or search_intelligence): each query's id, text and topic. Only non-branded, question-like searches are listed; a seed steers wording and is never copied into a prompt. There is no volume or impression count: never present a query as AI prompt volume. unavailable no_search_data means no source is connected. Pass the source as seed_source and the kept query ids as seed_query_ids to generate_prompts.",
    schema: z.strictObject(project),
    read: seedQueriesRead,
  }),
  read_actions: projectTool({
    title: 'Read Actions',
    description:
      'List the work CiteLadder recommends to improve visibility, highest priority first. Statuses: open (New), in_progress (accepted), done (declared implemented; its measurement is measuring or verified) and dismissed (Declined). By default it lists only open and in-progress Actions; pass status any to list every status, and query to find Actions whose title contains that text. Each item has its id, target (page, prompt or source), status, measurement, priority score, approach and link, and status_counts counts every status. Items come in pages; pass next_cursor for more. Pass site_url_id for the Actions on one page, or group_by for the grouped tree (the count and top items per group). Pass action_id for one Action in full: its diagnosis, each finding with its remediation, the measured outcome and any declaration. The update_action_status change kind accepts, declines or restores one. The declare_implemented change kind records that its work is done.',
    schema: z.strictObject({
      ...project,
      action_id: optional(
        uuid.describe('An Action id from a previous list, to read that one Action in full.'),
      ),
      status: optional(
        z
          .enum([...actionStatusSchema.options, ACTION_STATUS_ANY])
          .describe(
            'Keep only Actions with this status; any keeps every status. Omitted: open and in progress only.',
          ),
      ),
      query: optional(
        z
          .string()
          .trim()
          .min(1)
          .max(policy.opportunity.actions.ACTION_SEARCH_MAX_CHARS)
          .describe(
            'Keep only Actions whose title contains this text (case-insensitive). Combine with status any to search every status.',
          ),
      ),
      site_url_id: optional(uuid.describe('A page id (site_url_id) from read_site_pages.')),
      group_by: optional(actionTreeGroupBySchema.describe('Group the Actions this way.')),
      ...page,
    }),
    read: (read, args) => {
      if (args.action_id) return actionsRead(read, args);
      if (args.site_url_id && args.group_by)
        throw new McpInputError('Pass site_url_id or group_by, not both');
      if (args.site_url_id) return pageActions(read, { ...args, site_url_id: args.site_url_id });
      if (args.group_by) return actionGroups(read, { ...args, group_by: args.group_by });
      return actionsRead(read, args);
    },
  }),
  read_content_differentiation: projectTool({
    title: 'Read content comparisons',
    description:
      'Read how the competitor pages AI answers cite differ from your own page on the topics they win. Use it before rewriting a page to compete. It returns up to the 10 newest comparison reports, each with its query, the owned page compared, the features both have (parity), those only competitors have (gaps) and those only you have, each with the share of inspected pages showing it. A report with state insufficient_evidence had fewer than 3 readable competitor pages or no matching owned page. An empty list means no comparison was made yet; this tool never reads new pages. Use read_visibility_sources to find the competing pages first.',
    schema: z.strictObject(project),
    read: differentiationRead,
  }),
  read_ai_shelf: projectTool({
    title: 'Read the AI Shelf',
    description: `Read how AI answers recommend products for an ecommerce project, per product over a window of days. Without holder_id it returns the categories with product counts and one page of products, most visible first: for each, its holder_id, kind (owned, approved_competitor or ai_observed_competitor), visibility (share of the answers in scope that named it), appearances, win rate (share of its ordered appearances at rank 1), mean position, the median mentioned price beside the catalog price, and the merchant domains answers send shoppers to; executions is the number of answers in scope. source all adds competitors to your catalog; category_id narrows to one category; pass next_cursor for more. With holder_id it returns that product's page: the same metrics, its description and image, the products competing in the same answers, merchants, cited sources, fan-out queries, per-prompt metrics, the answers it appeared in (won, lost or unranked, with rank) and its open Actions. A null metric is unavailable (no answer in scope, or no ordered appearance), never zero. view overview is the shopping totals: shelf slots, share of shelf per brand, most and least visible products, merchants and fan-out. unavailable no_product_catalog means the project has no product catalog, which is normal for non-ecommerce brands; use read_visibility_overview for brand mentions instead. view catalog lists your products with their ids; competitor_candidates, buyer_prompts and discoveries (competitor searches still running) list the commerce setup with ids, each paged.`,
    schema: z.strictObject({
      ...project,
      view: z
        .enum([
          'products',
          'overview',
          'catalog',
          'competitor_candidates',
          'buyer_prompts',
          'discoveries',
        ])
        .default('products')
        .describe(
          'products is visibility per product (the default); overview is the totals; the others are setup.',
        ),
      holder_id: optional(
        uuid.describe('A holder_id from a previous product list, to read that product in full.'),
      ),
      source: optional(
        z
          .enum(['catalog', 'all'])
          .describe(
            'catalog (the default) lists your products; all adds approved and AI-observed competitors.',
          ),
      ),
      category_id: optional(
        uuid.describe('A category id from this tool, to list only its products.'),
      ),
      window_days: optional(
        z
          .number()
          .int()
          .describe(
            `Days of answers to read, one of ${policy.commerce.products.window_days.join(', ')}; omit for ${policy.commerce.products.default_window_days}.`,
          ),
      ),
      ...page,
    }),
    read: (read, args) =>
      args.view === 'products' || args.view === 'overview'
        ? shelfRead(read, { ...args, view: args.view })
        : commerceSetup(read, { ...args, view: args.view }),
  }),
};
