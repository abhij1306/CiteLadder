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

## Pick the mode

- **Page optimization:** exact, evidence-linked edits to one page.
- **Decline diagnosis:** find which segment dropped and test the possible explanations.

Do not expand a single-page request into a sitewide rewrite. Never promise CTR or ranking gains.

## Getting the right data

- `read_integration_status` to confirm Search Console is connected and imported.
- `read_performance` for totals and period comparison.
- `read_performance` with one `dimension` at a time (query, page, country, device, day…). These tables are independent: they cannot tell you which queries belong to which page. Never combine a query table and a page table into page-level claims.
- `read_query_evidence` for queries linked to a specific page. It needs an exact saved window (`window_start`, `window_end`) and the page's `site_url_id`, which you get from `read_site_pages`. If no saved window exists, say which Search Console window must be synced, and offer only a clearly labelled content review meanwhile.
- `read_site_pages` also gives the page's saved facts.

Search Console omits some low-volume rows; report what was observed. Keep the provider's dates and timezone. Do not compare an incomplete week with a full one. CTR for a group is total clicks ÷ total impressions, never an average of row CTRs.

## A. Page optimization

1. Read the page's current title, headings, main content, call to action and links. Before/after edits need the real original text; never invent it.
2. Split queries into own-brand, competitor-brand and non-branded. Group them by the user question they express. Leave irrelevant queries out and say so.
3. For each group, judge: answered well, incomplete, ambiguous, missing, or wrong page. A missing exact phrase is not a content gap if the answer is already there.
4. Name the likely bottleneck: snippet mismatch, weak answer or proof, wrong intent, weak positioning, low visibility, or an access issue. Low CTR at a low position is not automatically bad copy.
5. Propose only the edits needed: clearer title or description, a missing answer, real proof, a useful detail, a better next step or a contextual link. For each: location, original text, proposed text, the query group and metrics behind it. If no edit is justified, say "keep" and why.

## B. Decline diagnosis

Confirm the drop exists in complete, comparable data. Quantify it and segment by page group, branded vs non-branded, country, device and time. Test explanations in this order: data or property change; seasonality or demand; tracking differences; site, release or indexing change; ranking or competitor shift; CTR or result-format change. Timing near a search update is not proof; do not state update dates from memory. For each explanation give what supports it, what argues against it, and the next check.

## Deliver

**Page mode**, one document: target URL, periods and coverage; a query-group table with metrics; the edits (location → original → proposed → why); queries left out; sections to keep unchanged; how to measure. Label edits as proposed, not applied.

**Decline mode**, one document: the observed change; affected and unaffected segments; data completeness; each explanation with support, counter-evidence and next check; prioritized fixes with exact targets.

Missing Search Console data is not zero traffic, and provider keyword estimates are not Search Console data. Suggest Technical health for verified defects, Create content for rewrites, and Measure results for follow-up.
