---
id: internal_links
label: Internal links
group: owned_site
order: 6
version: 2
output_kind: link_plan
description: Improve contextual internal links to commercially important pages using CiteLadder page and crawl evidence. Use for supporting-page maps, weak inbound linking and orphan candidates; not blind link quotas.
---

# Internal links

## Goal

Make important pages easy to reach from relevant content, and guide readers to their next sensible step. The right destination is not always a commercial page; a guide, policy or help page can be the correct next step.

## Inputs

- `read_site_health` for the latest crawl and its coverage (pages crawled, crawl limits, date).
- `read_site_pages` with that `crawl_id` for page facts and each page's `site_url_id`.
- `read_site_links` with the `crawl_id` for inbound and outbound link counts across the site. These are aggregates, not a complete link graph. For the few priority targets the plan is about, read their own links in one call with their `site_url_ids`.
- `get_project_business_context` for the conversion pages that matter.

If the priority pages are not known, propose a small map (money, hub, support, trust pages) from what pages actually do, and say it is a proposal.

## Method

1. **State coverage.** How many pages were crawled, the crawl date and limits. A capped or partial crawl cannot prove a page is orphaned site-wide.
2. **Separate link types** when placement data exists: body links, navigation and footer, breadcrumbs, related-content modules. A link repeated across many pages is likely a template link; check before treating it as editorial.
3. **Count fairly.** Count distinct source pages per target, excluding self-links. A component repeated on 50 pages is not 50 editorial endorsements.
4. **Classify carefully:** _no inbound link found_ (within a complete-enough crawl), _orphan candidate_ (known from another list but crawl coverage is incomplete), or _only navigation links_. A page with no Search Console rows is not an orphan.
5. **Match supporting pages to targets.** Pick source pages whose readers naturally need the target next. Topic and reader task come first, then traffic and feasibility.
6. **Spot imbalance.** Important pages starved of contextual links, accidental template concentration, and links to redirected or broken pages. Do not remove useful hub or navigation links just to redistribute.
7. **Write each placement.** Source URL, target URL, the section and current sentence, the revised sentence, a descriptive anchor, and why it helps the reader. Skip placements that do not fit, even if a target has few links. Never invent the current text; if you do not have it, say the source copy is needed.

Some studies associate about four contextual inbound links with better performance. Use that only as an optional triage view if the user asks, never as a rule or a reason to add an irrelevant link.

## Deliver

One document with:

- **Plan:** page roles, coverage, and the main findings. Include link-count summaries only when the crawl supports them; otherwise call it a _candidate placement plan_, not a full audit.
- **Edits table:** source URL, target URL, section, current text, proposed text, anchor, placement type, reader benefit, target priority, dependency.

Do not claim a link is live after drafting it. Suggest Technical health for broken targets, Create content for missing supporting pages, and Measure results for follow-up.
