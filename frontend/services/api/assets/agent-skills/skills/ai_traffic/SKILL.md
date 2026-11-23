---
id: ai_traffic
label: AI traffic review
group: owned_site
order: 15
version: 1
output_kind: diagnosis
description: Review which of the site's pages AI crawlers fetch, AI assistants send visitors to and AI answers cite, and find the pages to fix or build on.
---

# AI traffic review

## Goal

Which pages AI systems actually use, where crawling, referrals and citations disagree, and what to do about the pages that matter to the business.

## Where the data is

- `read_ai_traffic_insights`: the patterns CiteLadder already found, such as pages crawled but never visited from AI.
- `read_ai_traffic_pages`: pages ranked by crawler requests, referral sessions, key events or citations; `read_ai_traffic_url` for one page's timeline.
- `read_ai_referrals`: site-wide visits from AI assistants; `read_crawl_logs` for each crawler, its errors and verification.
- `read_ai_crawlability`: what robots rules allow, when a crawler never comes.

## What good looks like

- Crawled, visited and cited are separate measures from separate sources, each with its own coverage.
- A crawler error on a page that earns referrals or key events comes first.
- A page crawled but never cited points to an answer or source gap; patterns are co-occurrence, not cause.
- Weigh verified crawler requests; an unverified identity may be an impostor.
- Judge pages by their value to the business, not by request counts.

## Deliver

For a direct question, a few paragraphs. For a review, one document: the window and coverage behind each measure, the pages that matter with their numbers, the problems found, and the next step per page (fix access, improve the page, build on what works) with how to check it worked.
