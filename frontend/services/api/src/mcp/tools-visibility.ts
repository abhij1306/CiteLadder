import { z } from 'zod';
import { policy } from '../config.ts';
import {
  adsRead,
  perceptionRead,
  factChecksRead,
  sourceUrl,
  visibilityOverview,
  visibilityResults,
  visibilitySources,
  visibilityTrends,
} from './evidence-analytics.ts';
import { auditRun, auditRuns, auditSchedules } from './evidence-runs.ts';
import { withCsvExport, sameNames } from './views-exports.ts';
import {
  marketHeadlines,
  sourceMovers,
  sourceNearMisses,
  sourceSeries,
  surfaceRatesView,
} from './views-visibility.ts';
import {
  optional,
  uuid,
  page,
  latestRun,
  project,
  engine,
  cohort,
  market_id,
  topic_id,
  url_filter,
  domain_filter,
  projectTool,
} from './tool-definitions.ts';

export const visibilityTools = {
  read_visibility_overview: projectTool({
    title: 'Read AI visibility',
    description:
      "Read the headline AI visibility of one run: how often answers mention the brand and cite its site, the visibility score, rankings of the brand against each competitor (mention rate, citation rate, share of voice, average position among the brands an answer named, win rate and net sentiment), a breakdown per engine with its win rate, and the run's status and answer counts. Win rate is how often a brand was named first among the answers naming any tracked brand; null win_rate or sentiment means unavailable or not applicable, never zero, and sentiment always comes with its classified count. It defaults to the latest completed run in the default market; pass baseline_id to compare two runs. view topics returns visibility, share of voice, position, rank and win rate per project topic; view matrix pairs engines, topics, markets and brands from each market's latest run, where not_run cells are unmeasured, never zero. view surface is AI Overview rates per search engine (trigger, brand and owned citation, each with its denominator); view markets is every market's latest headline. Pass topic_id to read one topic. Each market is measured separately: pass market_id for another market, and never pool markets. unavailable no_completed_run means no run has finished yet; metrics_pending means the latest run has finished but its results are still being written, so try again later rather than report that nothing was measured; topic_not_measured means the run asked no prompt in that topic. Use read_visibility_trends for change over time, read_prompt_metrics for which prompts are won or lost, read_competitors for one competitor in depth, read_visibility_results for the answers themselves, and read_visibility_sources for what was cited. view runs lists every audit with status and progress, newest first; view run with audit_id adds its failed answers; view schedules lists audit schedules with their ids.",
    schema: z.strictObject({
      ...project,
      market_id,
      audit_id: latestRun,
      baseline_id: optional(
        uuid.describe('With view summary: an earlier run id (audit_id) to compare against.'),
      ),
      engine,
      cohort,
      topic_id,
      view: z
        .enum(['summary', 'topics', 'matrix', 'surface', 'markets', 'runs', 'run', 'schedules'])
        .default('summary')
        .describe(
          'summary is the run (the default); topics is one row per topic; matrix is the engine, topic, market and brand grids; surface is Google AI Overview and AI Mode rates; markets lists every market; runs, run and schedules are paged.',
        ),
      ...page,
    }),
    read: (read, args) => {
      switch (args.view) {
        case 'runs':
          return auditRuns(read, args);
        case 'run':
          return auditRun(read, args);
        case 'schedules':
          return auditSchedules(read, args);
        case 'surface':
          return surfaceRatesView(read, args);
        case 'markets':
          return marketHeadlines(read, args);
        default:
          return visibilityOverview(read, { ...args, view: args.view });
      }
    },
  }),
  read_visibility_trends: projectTool({
    title: 'Read visibility trends',
    description:
      "Read how visibility changed over an explicit window of at most 366 days, as points per run or per day, week or month. Each point has the visibility score, brand mention and citation rates, share of voice, average position, rankings of every brand (with position and win rate), the model and whether web search was on, a comparison_key and events: what changed at that point (prompt_panel: prompts added, archived or removed; model_change: an engine's model changed; action_live: an Action went live). Points with different comparison keys were measured differently and are not comparable; name the events when you explain a change, and compare like with like. Gaps are missing runs, not zero. At most the newest 100 points are returned. Pass topic_id to follow one topic. unavailable no_measured_runs means no run fell in the window. Use read_visibility_overview for one run in depth, or with baseline_id to compare exactly two runs.",
    schema: z.strictObject({
      ...project,
      market_id,
      topic_id,
      from_at: z.iso
        .datetime({ offset: true })
        .describe('Start of the window, with a UTC offset, such as 2026-09-01T00:00:00Z.'),
      to_at: z.iso
        .datetime({ offset: true })
        .describe('End of the window, after from_at and at most 366 days later.'),
      engine,
      cohort,
      granularity: z
        .enum(['run', 'day', 'week', 'month'])
        .default('run')
        .describe('One point per run (the default), or per day, week or month.'),
      transport_model: optional(
        z
          .string()
          .trim()
          .min(1)
          .describe('Keep only runs answered by this model, as a previous point named it.'),
      ),
      retrieval_enabled: optional(
        z
          .boolean()
          .describe('true keeps only runs with web search on; false only runs without it.'),
      ),
    }),
    read: visibilityTrends,
  }),
  read_perception: projectTool({
    title: 'Read answer perception',
    description:
      "Read how AI answers portray the brand and competitors in the latest or a chosen run: net sentiment (-100 to +100) per brand, engine, topic and prompt, each with its coverage; praise and criticism by theme; per brand, competitors included, how many classified mentions raised each theme (theme_mentions, counts only: quotes are the brand's own); how often answers recommend or advise against the brand; and the sources cited alongside criticism. The summary view returns all of that; the quotes view lists the verified quotes behind it, paged (50 by default, pass next_cursor). The response is always available: read perception_state, where pending, unavailable or no_mentions means there is no value, never zero. Always state the coverage. Sources are cited alongside criticism, never its cause. Use read_fact_checks for whether answers are factually right, and read_visibility_overview for how often the brand is mentioned at all.",
    schema: z.strictObject({
      ...project,
      market_id,
      audit_id: latestRun,
      engine,
      cohort,
      view: z
        .enum(['summary', 'quotes'])
        .default('summary')
        .describe(
          'summary is sentiment and themes per brand; quotes lists the verified quotes, paged.',
        ),
      entity: optional(
        z
          .string()
          .trim()
          .min(1)
          .max(255)
          .describe('With view quotes: a brand exactly as the summary names it, to quote only it.'),
      ),
      theme: optional(
        z
          .string()
          .trim()
          .min(1)
          .max(policy.perception.project_themes.name_max_chars)
          .describe(
            'With view quotes: keep only quotes about this theme, as the summary names it.',
          ),
      ),
      polarity: optional(
        z
          .enum(['positive', 'negative'])
          .describe('With view quotes: keep only praise or only criticism.'),
      ),
      ...page,
    }),
    read: (read, args) => perceptionRead(read, { ...args, view: args.view }),
  }),
  read_fact_checks: projectTool({
    title: 'Read fact checks',
    description:
      "Read whether AI answers state the brand's facts correctly. Factual claims answers made about the brand in the latest or a chosen run are checked against the brand's confirmed facts. The summary view gives accuracy (supported out of supported plus contradicted) with its coverage, by topic and engine, the contradicted claims with the fact they contradict, and sources cited alongside them. The claims view lists every checked claim with its quote, verdict and the facts used, paged (50 by default, pass next_cursor); edited true means a person replaced the model's verdict, so report the person's. The facts view lists each confirmed fact with how many claims supported or contradicted it (counts kind not_raised or pending means no claim to count yet, never zero), to find the facts answers get wrong most. Use read_perception for tone rather than accuracy. Always state the coverage and quote the fact. accuracy_state not_enabled, no_facts, no_claims, pending or unavailable means there is no value, never zero; inconclusive and not_covered are not errors in the answer. Sources are cited alongside a contradiction, never its cause.",
    schema: z.strictObject({
      ...project,
      market_id,
      audit_id: latestRun,
      engine,
      cohort,
      view: z
        .enum(['summary', 'claims', 'facts'])
        .default('summary')
        .describe(
          'summary is accuracy and its coverage; claims lists the checked claims, paged; facts lists each fact with its verdict counts.',
        ),
      topic: optional(
        z
          .enum(policy.perception.fact_check.topics)
          .describe('With view claims: keep only claims about this kind of fact.'),
      ),
      verdict: optional(
        z
          .enum(['supported', 'contradicted', 'inconclusive', 'not_covered'])
          .describe('With view claims: keep only this verdict; contradicted finds the errors.'),
      ),
      ...page,
    }),
    read: async (read, args) =>
      args.view === 'claims'
        ? withCsvExport(read, await factChecksRead(read, args), {
            path: '/visibility/accuracy/claims/export',
            args,
            params: [
              ...sameNames('audit_id', 'engine', 'cohort', 'topic', 'verdict'),
              ['market', 'market_id'],
            ],
          })
        : factChecksRead(read, args),
  }),
  read_ai_ads: projectTool({
    title: 'Read ads in AI answers',
    description:
      'Paid ads shown in ChatGPT Search answers for the latest or a chosen run: ad presence rate ("N of M ChatGPT answers"), advertisers with share and first/last seen, the ad share and best rank of the brand itself, text creatives (paged) and prompts that surface ads with competitor ads beside organic brand mentions. Only ChatGPT Search shows ads; other engines are not_applicable, never zero. Ads are paid placements: report them separately, never as citations, sources or a cause of visibility.',
    schema: z.strictObject({
      ...project,
      market_id,
      audit_id: latestRun,
      engine,
      cohort,
      ...page,
    }),
    read: adsRead,
  }),
  read_visibility_results: projectTool({
    title: 'Read AI answers',
    description:
      "Read the answers engines gave in one run, to see exactly what an engine said for a prompt. Each answer has the prompt text, engine, model, repetition, whether web search was used, the brands mentioned (with first position) and every citation (URL, domain, whether it is your site or a competitor's), plus a citeladder:// id for fetch. It defaults to the latest completed run in the default market; unavailable no_completed_run means none has finished. Answers come in pages; pass next_cursor for more. Only core prompts are included unless cohort is comparison or all. Filters (prompt_id, topic_id, domain, url, engine) combine. For one prompt's answers across every run use read_prompt_metrics view answers. Use read_visibility_overview for rates and read_visibility_sources for citation totals.",
    schema: z.strictObject({
      ...project,
      market_id,
      audit_id: latestRun,
      engine,
      cohort,
      topic_id,
      prompt_id: optional(
        uuid.describe('A prompt id from read_prompt_portfolio; keep only its answers.'),
      ),
      domain: domain_filter,
      url: url_filter,
      ...page,
    }),
    read: visibilityResults,
  }),
  read_visibility_sources: projectTool({
    title: 'Read cited sources',
    description:
      "Rank the domains or pages AI answers cited in one run, to find the sources worth earning a place on. Each row has how many answers and prompts cited it, its citation share and rate, ownership (yours, a competitor's or third party) and category; page rows also list up to 3 brands named on the page and whether there is an Action for it. It defaults to the latest run; unavailable no_completed_run means none has finished. Rows come in pages; pass next_cursor for more. level domain lists publishers; level url, or passing domain, lists pages. Pass topic_id for the sources of one topic's answers. view near_misses lists your pages engines read but did not cite; movers, the sources whose citation share rose or fell against the comparable earlier run; series, citation share over time across runs (pass domain for one source). Use read_source_url for one page in depth, and read_visibility_results for the answers that cite it.",
    schema: z.strictObject({
      ...project,
      market_id,
      audit_id: latestRun,
      engine,
      cohort,
      topic_id,
      level: z
        .enum(['domain', 'url'])
        .default('domain')
        .describe('domain counts publishers (the default); url counts individual pages.'),
      domain: optional(
        z
          .string()
          .trim()
          .min(1)
          .max(253)
          .describe('A cited domain such as example.com; with level url, lists its pages.'),
      ),
      view: z.enum(['ranking', 'near_misses', 'movers', 'series']).default('ranking'),
      granularity: z
        .enum(['day', 'week', 'month'])
        .default('week')
        .describe('With view series: the length of each point.'),
      ...page,
    }),
    read: (read, args) => {
      if (args.view === 'near_misses') return sourceNearMisses(read, args);
      if (args.view === 'movers') return sourceMovers(read, args);
      if (args.view === 'series') return sourceSeries(read, args);
      return visibilitySources(read, args);
    },
  }),
  read_source_url: projectTool({
    title: 'Read a cited page',
    description: `Read one cited page in depth, after read_visibility_sources or an answer names it: how often it was retrieved and cited, when first and last seen, the engines and models that cite it, the prompts it is cited for (up to ${policy.visibility.source_url_max_prompts}), the brands it names (up to ${policy.visibility.source_url_max_brands}, including whether yours is there), and what CiteLadder read on the page itself. Omit audit_id to cover every run in the market, not just the latest. The URL must match the cited URL exactly; unavailable url_not_cited_in_selection means it was not cited in that selection.`,
    schema: z.strictObject({
      ...project,
      market_id,
      url: z
        .string()
        .trim()
        .min(1)
        .max(8192)
        .describe('A cited URL exactly as read_visibility_sources or an answer listed it.'),
      audit_id: optional(uuid.describe('A run id (audit_id); omit for every run.')),
      engine,
      cohort,
    }),
    read: sourceUrl,
  }),
};
