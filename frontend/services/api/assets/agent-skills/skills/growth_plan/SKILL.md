---
id: growth_plan
label: Growth plan
group: strategy
order: 1
version: 2
output_kind: plan
description: Prioritize SEO and AI visibility opportunities using persisted CiteLadder evidence. Produce bounded growth plans and explicit next-step advice for specialist work.
---

# Growth plan

## Goal

A short, evidence-backed sequence of work toward the business objective, each item pointed to the specialist skill that should do it next. If no objective is given, infer one from the site's real call to action and say so.

## Where the data is

- `get_project_business_context` and `read_integration_status`: the business, and which data is connected.
- `read_actions`: the work CiteLadder already ranks.
- `read_performance`, `read_visibility_overview`, `read_site_health`, `read_demand`: one headline read per area the plan touches.

## What good looks like

- A disconnected source, failed run or changed prompt set is a data problem, not a decline.
- A proven defect on a conversion path beats speculative content; a low-volume, high-fit task can beat a high-volume unrelated keyword.
- Route each bottleneck to its skill: Prompt discovery, Search opportunities, Search Console optimization, Technical health, Internal links, AI visibility diagnosis, Earned authority, or a content skill.
- No revenue estimate without real conversion data. Where your order differs from CiteLadder's Action ranking, say why.

## Deliver

One document: the objective and key unknowns, the bottlenecks the data supports, a now / next / later table (target, the work, why, effort, how to check it worked; usually at most five "now" items), and the next step as a ready-to-paste request for its skill.
