---
id: measure
label: Measure results
group: strategy
order: 2
version: 2
output_kind: measurement
description: Measure SEO and AI visibility interventions using stable CiteLadder cohorts, baselines and evidence. Use for experiment design, before-after reviews and weekly decisions; not guaranteed attribution or automatic scheduling.
---

# Measure results

## Goal

Say whether an implemented change was followed by a meaningful measured change, what is still uncertain, and what to do next. If nothing has been implemented or no follow-up data exists yet, deliver a measurement plan with a baseline instead. Running this skill does not schedule monitoring.

## Inputs

- What changed and when: `read_actions` (with `action_id` for the implementation declaration and verification), earlier results in this chat, or the user's description.
- AI visibility over time: `read_visibility_trends` with an explicit `from_at`/`to_at` window; `read_visibility_overview` with `audit_id` and `baseline_id` for a direct comparison of two audits.
- Answer tone: `read_perception` for each compared `audit_id`; always state its coverage ("N of M mentions classified"); a pending or unavailable read has no value, never zero. Sources it lists were cited alongside criticism, never shown to cause it. Compare runs only when their perception versions match.
- Search: `read_performance` with a comparison period; `read_query_evidence` for a page's queries.
- Data gaps: `read_integration_status`.

Confirm it is the same page or asset, the change date, and the same prompts, engines and settings before comparing.

## Method

1. **Define the question.** Target, change, expected effect (a hypothesis), one primary metric and one guardrail. Without revenue data, name the proxy you use.
2. **Separate draft from live.** A drafted edit is not an implemented change. Use the implementation date the user or the Action records. Results collected before the change was live cannot measure it.
3. **Use a comparable baseline.** Same window length, prompts and prompt versions, engines, cohort, locale and settings. Default: matched complete 28-day windows for search; a stable repeated prompt set for AI. Report new or retired prompts separately; a changed prompt starts a new series.
4. **Fix denominators before looking at wins.** Search CTR is clicks ÷ impressions over the group. For AI, report mentions, owned citations, recommendations and recommendations against separately, each over valid answers. Failed runs are listed, not counted as zero. For AI Overviews, report how often an Overview appeared, then outcomes within those.
5. **Show the change plainly:** baseline count/denominator and rate, follow-up count/denominator and rate, the change in percentage points, and relative change only if the baseline is not zero. Example of the arithmetic only: 8/20 → 10/20 is +10 percentage points, not +10%.
6. **Be honest about uncertainty.** Small samples, paraphrased prompts, model updates and engine variability limit what you can conclude. Do not call a change significant without a suitable test. Before/after with no control shows association, not cause; list concurrent changes you know of.
7. **Decide:** `continue`, `expand cautiously`, `revise`, `rollback` or `inconclusive`, tied to the primary metric and guardrail. Roll back promptly only for verified harm (broken journey, accidental noindex, false claim); weak evidence usually means observe longer.

Never pick the most favorable window, drop losing prompts, or rerun only failures.

## Deliver

**Plan (no follow-up yet):** target, goal, hypothesis, baseline values and windows, the change, when it counts as live, comparison design, primary metric and denominator, guardrail, minimum meaningful change, decision rules, known confounders.

**Review (follow-up exists):** what was implemented and when; baseline vs follow-up counts, rates and changes; coverage, failures and prompt changes; uncertainty and confounders; the decision and next action. Add a measurement table (target, metric, count, denominator, period, result) when it helps.

No ROI figure without known costs and real revenue attribution.
