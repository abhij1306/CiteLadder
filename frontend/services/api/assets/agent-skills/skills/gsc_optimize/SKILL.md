---
id: gsc_optimize
label: Search Console optimization
group: owned_site
order: 5
version: 2
output_kind: page_edits
description: Diagnose organic traffic changes or produce exact page edits from CiteLadder GSC evidence. Use for impressions, CTR, queries and page performance; requires page-linked queries for page-specific keyword claims.
---

# Search Console optimization

## Goal

Either exact, evidence-linked edits to one page, or a diagnosis of which segment dropped and why. Do not expand a single-page request into a sitewide rewrite, and never promise CTR or ranking gains.

## Where the data is

- `read_performance`: totals and comparisons, or one dimension at a time (query, page, country, device). Query and page tables are independent: never combine them into page-level claims.
- `read_query_evidence`: the queries linked to one page, for a saved window from `read_demand`.
- `read_page_text`: the page's current title, headings and copy, which before/after edits need.

## What good looks like

- Split own-brand, competitor-brand and non-branded queries, and group them by the buyer question they express.
- A missing exact phrase is not a content gap if the answer is already there; low CTR at a low position is not automatically bad copy.
- Group CTR is total clicks ÷ total impressions. Do not compare an incomplete week with a full one.
- For a drop, test data or property changes, seasonality, tracking, site changes, ranking shifts and result-format changes; timing near a search update is not proof.

## Deliver

Page mode: the query groups with metrics, then each edit as location → original → proposed → why, and what to keep. Decline mode: the observed change, affected and unaffected segments, each explanation with support, counter-evidence and the next check, and prioritized fixes.
