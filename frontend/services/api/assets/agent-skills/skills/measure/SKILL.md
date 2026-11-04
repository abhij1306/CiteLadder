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

Whether an implemented change was followed by a meaningful measured change, and what to do next. With nothing implemented or no follow-up data yet, a measurement plan with a baseline instead.

## Where the data is

- `read_actions` with the Action's id, or filtered to implemented or measuring Actions: what changed and when it went live.
- `read_visibility_trends` for a window, and `read_visibility_overview` with a baseline run for a direct comparison of two runs.
- `read_performance` with a comparison period, and `read_query_evidence` for one page's queries.
- `read_perception`: tone, comparable only between runs of the same version.

## What good looks like

- Compare like with like: same page, prompts, engines, cohort and window length. A changed prompt starts a new series.
- A drafted edit is not a live change; data from before it went live cannot measure it.
- Show count/denominator and rate on both sides and the change in percentage points: 8/20 → 10/20 is +10 points, not +10%.
- Small samples and engine variability limit conclusions. Never pick the most favourable window or drop losing prompts.

## Deliver

Plan: target, hypothesis, baseline values and windows, primary metric and guardrail, decision rules. Review: what changed and when, baseline vs follow-up, limits and concurrent changes, and the decision (continue, expand cautiously, revise, roll back or inconclusive).
