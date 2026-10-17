---
id: programmatic_seo
label: Programmatic SEO pilot
group: content
order: 12
version: 2
output_kind: plan
description: Design a small data-backed programmatic SEO pilot with real per-page value, quality gates and a maintenance plan. Use for repeatable page families, not mass keyword-swapped or doorway pages.
---

# Programmatic SEO pilot

## Goal

Decide whether a repeatable family of pages is justified, and if so specify a small pilot. A grid of keyword combinations is not an opportunity by itself; each page must give a distinct buyer something real.

## Inputs

You need the verified offer and audience (`get_project_business_context`), a repeated buyer task, and a real source of differentiated data or functionality for each page. Useful extras: search demand (`read_search_intelligence`, `read_search_dataset`, `read_performance` with a `dimension`), existing pages (`read_site_pages`), and AI prompt gaps (`read_prompt_portfolio`).

## Method

1. **Test the premise.** For each pattern: the buyer question, why it matters commercially, what varies, and what each page does that one good page could not. Families can be tools, examples, integrations, locations, comparisons, directories or profiles; consider only patterns the business actually supports.
2. **Check truth.** Each combination must be a real product, service, integration, location or dataset. One office does not make nationwide local pages; an unbuilt integration is not an integration.
3. **Check demand and existing pages.** Use matched query data when available. Low volume can still serve a real need; high combined volume does not justify poor-fit pages. Do not add up volumes of overlapping variants. Avoid duplicating existing pages.
4. **Define the data contract.** Fields, source and owner, rights to publish, update frequency, validation, units, and what happens when data is missing or stale. You never invent a value to make a row publishable.
5. **Design per-page value.** Conditional sections driven by the row's data. Swapped names are not value. Say when one category page or tool would serve better.
6. **Pick a pilot.** A typical case, a rich case and a sparse or edge case; three to five pages is a sensible default. Draft complete pages only for rows with enough verified data; show why sparse rows fail.
7. **Architecture.** Stable URLs on the existing domain and route pattern, canonicals, hub pages, internal links and sitemap inclusion for eligible pages only. No indexable filter combinations or location doorways.
8. **Gates before scale.** Each row must pass: complete facts, distinct value, intent match, no duplicate, correct links and metadata, an owner for updates. Failed rows stay unpublished.
9. **Release and observe** (the user publishes). Check indexing, useful traffic, engagement and conversions, and whether existing pages lose queries. Scale only if quality, value and maintenance capacity hold; stop if rows cannot be maintained or only simulate coverage.

## Deliver

One document with:

- **Pilot plan:** the pattern, audience and offer, demand evidence, why separate pages help, rejected alternatives, data contract, eligibility rules, URL and link structure, chosen pilot rows, success measures, stop rules and owner.
- **Page template:** placeholders and conditional sections, title and meta rules, where facts and sources appear, the call to action, and behavior for empty or stale data. Mark placeholders clearly as template variables.
- **Pilot table:** proposed URL, buyer task, data source, unique value, data completeness, freshness, duplicate check, eligible (yes/no), blocker, review owner.
- Complete pilot drafts when asked and supported.

No minimum word counts or "percent unique text" rules. Suggest Technical health for architecture checks, Internal links for link design, and Measure results for evaluation.
