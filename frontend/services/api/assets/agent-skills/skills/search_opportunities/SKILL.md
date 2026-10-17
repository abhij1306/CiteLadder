---
id: search_opportunities
label: Search opportunities
group: demand
order: 3
version: 2
output_kind: research
description: Find commercially relevant keyword, topic and competitor gaps using CiteLadder demand, GSC, SERP and visibility evidence. Use for research and content planning, not automatic page generation.
---

# Search opportunities

## Goal

Decide which buyer needs to serve, on which existing or new pages, and why.

## Inputs

- `get_project_business_context` for offers, audience, markets and conversion pages.
- `read_demand` for demand clusters.
- `read_performance` with `dimension` `query` or `page` for Search Console queries and pages (separate tables; they do not say which query belongs to which page).
- `read_search_intelligence` to list keyword, SERP and competitor datasets, then `read_search_dataset` to page through one.
- `read_visibility_results` and `read_visibility_sources` for AI answer gaps.
- `read_site_pages` for existing pages.

A quantitative gap claim needs the dataset behind it. Without demand data, label the work a hypothesis.

## Pick the mode

- **Named competitor:** study that domain first; do not turn it into a market survey.
- **Landscape:** a representative set of queries; classify recurring domains; call a small set directional.
- **Clustering:** deliver a page map (primary query, related intents, existing or proposed page, evidence needed, decision), not a list of keyword groups.

## Method

1. **Start from the business:** audience → offer → buyer task → topic. Do not expand into a generic keyword universe.
2. **Inventory what works.** Existing useful pages, current queries and visibility gaps. Check existing pages before proposing a new one; mark a page "proposed" if you did not inspect the inventory.
3. **Type the competitors:** direct business alternatives, search-result competitors, AI-answer competitors, cited publishers. A directory can compete for attention without selling the same thing. Keep the user's chosen competitors and label any additions.
4. **Ground each opportunity** in the query data and any matching dataset, with its market, device and date. Do not describe search result pages you have not read, and never invent ranks, volumes or difficulty.
5. **Cluster by the same buyer job**, not just similar words. Split when the decision, offer or format differs. Zero estimated volume does not prove no need.
6. **Compare coverage** against what was inspected only: missing questions, outdated facts, weak proof, wrong format. "Absent from five inspected pages" is not "unique on the internet".
7. **One action per opportunity:** keep, refresh, expand, create, merge-review, reposition or defer. Two pages sharing a query is not cannibalization unless intent or performance shows harm. Never recommend automatic deletion.
8. **Prioritize** by business fit, existing demand, achievable differentiation, effort and dependencies. A low-volume, high-fit topic can lead. Difficulty scores are provider estimates, not a verdict.

## Deliver

One document with:

- A short competitor map.
- A prioritized opportunity table: buyer task, topic, query group, market and language, intent, provider metrics with source and date, existing page, recommended action, proposed page, format, what makes it different, proof needed, effort, how to check success.
- A brief for each accepted topic: reader, the exact question to answer, relevant product facts, page decision, evidence to add, format, internal link targets and conversion.

No filler content calendars. Suggest Create content for accepted briefs, Comparison content for named comparisons, Programmatic SEO pilot for repeatable patterns, and Earned authority for source gaps.
