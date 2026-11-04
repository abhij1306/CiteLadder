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

The few real technical defects that matter, ordered by the business journeys they affect, each with a fix an engineer can implement. Never optimize a score for its own sake.

## Where the data is

- `read_site_health`: the latest crawl, its coverage and top issues. If there is no crawl, say one must be run in CiteLadder.
- `read_site_pages`: pages by URL, type or issue, with what each check found. An issue's supplied occurrences plus 3–5 representative pages are enough to plan a fix.
- `read_page_text`: the words of a page that is directly relevant.
- `read_ai_crawlability` and `read_crawl_logs`: what robots rules allow each AI bot, and the visits actually seen.

## What good looks like

- A shared template or setting behind many pages is a hypothesis the person verifies, named as such; a sample of N of M pages is enough to propose it.
- "Can be crawled", "eligible for indexing" and "indexed" are different. A 200 status does not prove useful content; an allowed bot does not prove citation.
- Saved crawl data is not the live site: a fix needs a check on the live page before it ships.
- Respect intended policy: a deliberate noindex on search or account pages is not a defect, and "allow every AI bot" is not a default fix. Missing `llms.txt` or an "agent readiness" level is not a proven defect.
- Structured data must match visible content and the page's purpose.

## Deliver

A short fix plan: each defect with its severity (blocker, material, improvement or needs verification) and why, the pages affected (sample of N of M), the proposed change, who owns it and how to check it worked. Fixes are proposals; only the person declares one done.
