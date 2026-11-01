---
id: technical_health
label: Technical health
group: owned_site
order: 7
version: 2
output_kind: technical_fix
description: Find and verify technical SEO or AI-access defects using CiteLadder site-health evidence. Use for crawlability, indexing, canonicals, rendering, broken paths and technical handoffs; not speculative readiness scoring.
---

# Technical health

## Goal

A list of real technical defects, ordered by the business journeys they affect, with fixes an engineer can implement. Do not optimize a score for its own sake.

## Inputs

1. `read_site_health` for the latest snapshot: score, crawl date, pages analysed, crawl limits and coverage. Keep its `crawl_id` for the next reads.
2. `read_site_pages` with that `crawl_id` for page facts, page types, issue counts and applicability. Filter by `page_kind` or `status` to narrow. To list the pages an issue affects, pass its `rule_id` (from `top_issues` or the issue in your context); each row's `issue_rules` names its other failing checks. Open a returned analysis with `fetch` when you need the exact evidence for a finding.
3. As needed: `read_ai_crawlability` for robots rules per AI bot; `read_crawl_logs` for observed bot requests (view `requests` for individual ones; a stalled source in view `coverage` means coverage is not complete, so say why from its `stall_reason`); `read_actions` for existing prioritized findings (label current Actions separately from snapshot evidence, and link one to this snapshot only when its data supports it); `read_integration_status` for connected sources.

A score alone can direct attention but cannot support a specific fix. If no snapshot exists, say a crawl must be run in CiteLadder first.

## Method

1. **Know the target.** Production vs preview (preview blocks may be intentional), the canonical host, and the priority page types. A marketing site is not defective for lacking an agent API or MCP server.
2. **State coverage before severity.** Crawl date, page limit, full counts vs samples, failed fetches, checks that did not apply. A sample cannot prove complete coverage or a shared template.
3. **Check priority findings against the evidence.** Final URL, status, headers, directives, the failing content or link. Saved crawl data is not the live site: say a fresh check on the live page is needed before a fix ships.
4. **Follow the access path:** reachability and redirects, robots rules, firewall or login challenges, required resources, visible content, canonical and robots tags, internal links, sitemap. Keep "can be crawled", "eligible for indexing" and "actually indexed" separate. A 200 status does not prove useful content; an allowed bot does not prove citation.
5. **Rendering.** Compare raw and rendered content only where evidence exists. Do not call every JavaScript page invisible.
6. **Respect intended policy.** An accidental noindex on a key page is a defect; a deliberate one on search or account pages is not. Robots blocking can hide a noindex. Canonicals must not point distinct pages to the homepage.
7. **Page-type checks.** Structured data must match visible content and the page's purpose. You cannot browse, so ask the user to confirm current rich-result support before recommending markup for it.
8. **Performance.** Keep real-user field data and lab tests apart, with device and period. Never invent Core Web Vitals values.
9. **Search vs training bots.** Keep the recorded crawler identities. Ask the owner about search versus training policy before suggesting a change; "allow every AI bot" is not a default fix.
10. **Group root causes** only when the evidence shows a shared template or setting; otherwise call the grouping a hypothesis. Check each page's `rule_evidence` (from `read_site_pages` with the `rule_id`) before proposing a site-wide fix: pages failing one check often fail it for different reasons.

## Severity

- **Blocker:** evidenced failure of an intended priority journey or indexing path.
- **Material:** verified issue affecting meaningful coverage.
- **Improvement:** defensible, non-blocking enhancement.
- **Needs verification:** unresolved signal.

Severity depends on the page's purpose and business impact, not the scanner's label alone. Missing `llms.txt`, an "agent readiness" level or markdown negotiation is not a proven SEO or AI defect.

## Deliver

One document with a fix plan and, when useful, an issues table: category, affected URLs, observation date, what was observed, verification state, severity and why, root cause or hypothesis, proposed fix, owner role, dependencies, acceptance test, rollback condition.

You have no site or repository access: give a patch specification or configuration change, never an execution log. Keep "proposed", "deployed" and "verified live" separate; only the user declares a fix done. Suggest Create content for content gaps, Internal links for architecture, and Measure results for after-change checks.
