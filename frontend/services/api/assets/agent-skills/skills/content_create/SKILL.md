---
id: content_create
label: Create content
group: content
order: 10
version: 4
output_kind: content
description: Write or refresh complete articles, buyer guides, homepages, landing pages, YouTube scripts and community/social drafts using CiteLadder business and search evidence. Use for actual content delivery, not generic recommendations.
---

# Create or refresh content

## Goal

Write the complete piece the user asked for, grounded in the business's real facts and the buyer questions CiteLadder has measured. You do the writing; the tools supply facts and demand, not prose.

## How the work flows

- Answer questions about the content or the draft directly, without saving a new document.
- Choose the format and set `format_id`. Long-form formats start with an outline (audience, angle, sections, key facts, call to action) for the user to approve; then write the full piece. Short formats (X, LinkedIn, Instagram, TikTok, Reddit, glossary definition) are drafted directly.
- Follow the guidance for the chosen format.
- Use Comparison content for named competitor comparisons and Programmatic SEO pilot for repeated page families.
- When the chat starts from an earlier result (a brief or plan), reuse its decisions; do not restart research.

## Inputs

You need the audience, the offer, the topic or target page, and the purpose. Get them from the context and `get_project_business_context`; ask one grouped question only if a missing fact would change the piece. Useful extras:

- Real search queries for the target page: `read_query_evidence` (needs the page's `site_url_id` from `read_site_pages` and the saved window from `read_demand`).
- Buyer questions and AI answers: `read_prompt_portfolio`, `read_visibility_results` (with an `audit_id` from `read_visibility_overview`).
- Existing pages: `read_site_pages` for saved page facts (open a returned analysis with `fetch` for detail), or page text the user supplied.

Internal analytics can guide the topic but do not belong in the published copy.

## Method

1. **Check what exists.** Read the target page and related owned pages. Decide: refresh, expand, merge, or create new. Do not create a near-duplicate for a keyword variant. In a rewrite, keep what already works.
2. **Collect the facts you will use.** Every factual claim in the copy needs a source in this chat or from the user. Missing prices, features or requirements become requests in the editorial notes, never placeholders or guesses. Never invent sources, quotes, testimonials, experiences, dates or statistics.
3. **Find the real contribution.** What does this piece give the reader beyond a generic summary: a clear explanation of a hard decision, real data, a worked example, usable steps, an honest comparison?
4. **Structure from the task.** Lead with the answer or the page's main point. Use tables only for comparable facts, steps for processes, FAQs only for real questions. Keep qualifiers next to the claims they limit. No word counts, keyword density or fixed section counts.
5. **Write it fully.** Clear, specific language in the brand's voice. Say who it is not for. Use natural language, not exact-match stuffing. Link third-party facts to their public source. A proposed URL is a plan, not an existing page.
6. **Edit hard.** Remove unsupported claims, generic openings, repetition, superlatives and false urgency. Check numbers, units, names, links and prices.

## Deliver

One document with:

- **The content:** title or H1, proposed URL, meta title and description, the complete copy, links and call to action. For several channels, one complete draft per requested channel, all using the same facts.
- **Editorial notes:** audience and intent, why this structure, the key claims and where each came from, facts still needing confirmation, the existing-page decision, a change log for refreshes, and how to measure the result.

For a brief-only request, deliver the brief and stop. A draft with unresolved key facts is labelled partial, with the blocker named. Regulated claims need an authoritative source and expert review. Never say content is published or live; you have no site or CMS access.
